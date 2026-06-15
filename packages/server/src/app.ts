import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  LevelResultSchema,
  applyLevelResult,
  emptyProgress,
  type Progress,
} from '@sourcerealm/shared'
import type { EventEmitter } from 'node:events'
import { LevelGenerator, taskRefs, type GenEvent } from './generator.js'
import { detectProviderMode, selectProvider, type LLMProvider } from './providers.js'
import { RepoScanner } from './scanner.js'
import { ProjectStore, projectIdFor } from './store.js'
import { CourseUpdater, checkForUpdates, type UpdateEvent } from './updater.js'

export interface AppOptions {
  /** 测试注入;缺省时首次导入懒探测 claude CLI / API key */
  provider?: LLMProvider
  /**
   * web 构建产物目录;缺省自动探测 packages/web/dist。
   * 传 null 可显式关闭静态托管(测试用)。
   */
  webDist?: string | null
}

/** 自动探测 packages/web/dist(相对 packages/server/src/app.ts) */
function defaultWebDist(): string {
  return path.resolve(fileURLToPath(import.meta.url), '../../../web/dist')
}

const ImportBodySchema = z.object({ path: z.string().min(1) })
const LevelDoneBodySchema = z.object({
  levelId: z.string().min(1),
  result: LevelResultSchema,
  taskCount: z.number().int().positive(),
})
const FileReadBodySchema = z.object({ file: z.string().min(1) })

function anthropicApiBaseInfo(): { apiBaseUrl: string; apiBaseUrlSource: 'env' | 'default' } {
  const configured = process.env.ANTHROPIC_BASE_URL?.trim()
  return configured
    ? { apiBaseUrl: configured, apiBaseUrlSource: 'env' }
    : { apiBaseUrl: 'https://api.anthropic.com', apiBaseUrlSource: 'default' }
}

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  // 本地工具,放开 CORS 以便 vite dev(不同源)直接访问 API
  await app.register(cors, { origin: true })
  let provider = opts.provider ?? null
  /**
   * projectId → 运行中的生成器/更新器(SSE 订阅 + 防重复启动)。
   * LevelGenerator 与 CourseUpdater 都是 EventEmitter 且 emit 'event',接口统一。
   */
  type Runnable = EventEmitter & { run(): Promise<void> }
  const generators = new Map<string, Runnable>()

  async function getProvider(): Promise<LLMProvider> {
    if (!provider) provider = await selectProvider()
    return provider
  }

  async function startGeneration(store: ProjectStore, scanner: RepoScanner): Promise<void> {
    if (generators.has(store.id)) return
    const llm = await getProvider()
    // getProvider 有 await,重查一次防止并发导入同一项目时双开生成器
    if (generators.has(store.id)) return
    const gen = new LevelGenerator(store, scanner, llm)
    generators.set(store.id, gen)
    void gen.run().finally(() => generators.delete(store.id))
  }

  // 导入项目(已存在则复用并按需续跑生成)
  app.post('/api/projects', async (req, reply) => {
    const body = ImportBodySchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: '缺少 path 参数' })
    let scanner: RepoScanner
    try {
      scanner = await RepoScanner.open(body.data.path)
    } catch (err) {
      return reply.code(400).send({ error: String((err as Error).message) })
    }
    const id = projectIdFor(scanner.root)
    const store = new ProjectStore(id)
    let meta = await store.readMeta()
    if (!meta) {
      meta = {
        id,
        path: scanner.root,
        name: path.basename(scanner.root),
        isGit: scanner.isGit,
        anchorCommit: await scanner.head(),
        createdAt: new Date().toISOString(),
        generation: { status: 'idle' },
      }
      await store.writeMeta(meta)
      await store.writeProgress(emptyProgress())
    }
    if (meta.generation.status !== 'done') await startGeneration(store, scanner)
    return { id, name: meta.name }
  })

  app.get('/api/projects', async () => ({ projects: await ProjectStore.list() }))

  // 当前 AI Provider(导入向导展示用;不触发懒探测之外的副作用)
  app.get('/api/provider', async () => {
    const mode = detectProviderMode()
    try {
      const llm = await getProvider()
      const apiInfo = mode === 'anthropic-api' || llm.name === 'anthropic-api' ? anthropicApiBaseInfo() : {}
      return { mode, available: true, name: llm.name, ...apiInfo }
    } catch (err) {
      const apiInfo = mode === 'anthropic-api' ? anthropicApiBaseInfo() : {}
      return { mode, available: false, error: String((err as Error).message), ...apiInfo }
    }
  })

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const store = new ProjectStore(req.params.id)
    const meta = await store.readMeta()
    if (!meta) return reply.code(404).send({ error: '项目不存在' })
    return {
      meta,
      course: await store.readCourse(),
      progress: (await store.readProgress()) ?? emptyProgress(),
    }
  })

  // 重试/继续生成
  app.post<{ Params: { id: string } }>('/api/projects/:id/generate', async (req, reply) => {
    const store = new ProjectStore(req.params.id)
    const meta = await store.readMeta()
    if (!meta) return reply.code(404).send({ error: '项目不存在' })
    const scanner = await RepoScanner.open(meta.path)
    // 把 failed 的关卡重置为 pending 以便重试
    const course = await store.readCourse()
    if (course) {
      for (const ch of course.chapters)
        for (const lv of ch.levels) if (lv.status === 'failed') lv.status = 'pending'
      await store.writeCourse(course)
    }
    await store.writeMeta({ ...meta, generation: { status: 'generating' } })
    try {
      await startGeneration(store, scanner)
    } catch (err) {
      await store.writeMeta({ ...meta, generation: { status: 'error', error: String((err as Error).message) } })
      throw err
    }
    return { ok: true }
  })

  // 增量更新检测:仓库自锚点以来是否有变更(不调用 LLM)
  app.get<{ Params: { id: string } }>('/api/projects/:id/update-check', async (req, reply) => {
    const store = new ProjectStore(req.params.id)
    const meta = await store.readMeta()
    if (!meta) return reply.code(404).send({ error: '项目不存在' })
    if (!meta.isGit || !meta.anchorCommit) return { changed: false, reason: 'not-git' }
    const scanner = await RepoScanner.open(meta.path)
    return checkForUpdates(store, scanner)
  })

  // 启动增量更新(同 generators Map 防重复;SSE 复用 /events)
  app.post<{ Params: { id: string } }>('/api/projects/:id/update', async (req, reply) => {
    const store = new ProjectStore(req.params.id)
    const meta = await store.readMeta()
    if (!meta) return reply.code(404).send({ error: '项目不存在' })
    if (!meta.isGit || !meta.anchorCommit) {
      return reply.code(400).send({ error: '非 git 仓库,无法增量更新' })
    }
    if (generators.has(store.id)) return { ok: true }
    const scanner = await RepoScanner.open(meta.path)
    const llm = await getProvider()
    if (generators.has(store.id)) return { ok: true }
    const updater = new CourseUpdater(store, scanner, llm)
    generators.set(store.id, updater)
    void updater.run().finally(() => generators.delete(store.id))
    return { ok: true }
  })

  // 生成进度 SSE
  app.get<{ Params: { id: string } }>('/api/projects/:id/events', async (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    const gen = generators.get(req.params.id)
    if (!gen) {
      reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
      reply.raw.end()
      return reply
    }
    const close = () => {
      gen.off('event', onEvent)
      reply.raw.end()
    }
    const onEvent = (e: GenEvent | UpdateEvent) => {
      reply.raw.write(`data: ${JSON.stringify(e)}\n\n`)
      if (e.type === 'done' || e.type === 'error') close()
    }
    gen.on('event', onEvent)
    req.raw.on('close', close)
    return reply
  })

  // 读取关卡 + 引用新鲜度
  app.get<{ Params: { id: string; levelId: string } }>(
    '/api/projects/:id/levels/:levelId',
    async (req, reply) => {
      const store = new ProjectStore(req.params.id)
      const meta = await store.readMeta()
      if (!meta) return reply.code(404).send({ error: '项目不存在' })
      const level = await store.readLevel(req.params.levelId)
      if (!level) return reply.code(404).send({ error: '关卡不存在' })
      const scanner = await RepoScanner.open(meta.path)
      const freshness: Record<string, boolean> = {}
      for (const task of level.tasks) {
        const checks = await Promise.all(taskRefs(task).map((r) => scanner.readRef(r)))
        freshness[task.id] = checks.every((c) => c.fresh)
      }
      return { level, freshness }
    },
  )

  // 读取源码文件
  app.get<{ Params: { id: string }; Querystring: { path?: string } }>(
    '/api/projects/:id/file',
    async (req, reply) => {
      const store = new ProjectStore(req.params.id)
      const meta = await store.readMeta()
      if (!meta) return reply.code(404).send({ error: '项目不存在' })
      if (!req.query.path) return reply.code(400).send({ error: '缺少 path 参数' })
      const scanner = await RepoScanner.open(meta.path)
      try {
        return { content: await scanner.readFile(req.query.path) }
      } catch {
        return reply.code(404).send({ error: '文件不存在' })
      }
    },
  )

  // 文件树(前端文件浏览器用)
  app.get<{ Params: { id: string } }>('/api/projects/:id/tree', async (req, reply) => {
    const store = new ProjectStore(req.params.id)
    const meta = await store.readMeta()
    if (!meta) return reply.code(404).send({ error: '项目不存在' })
    const scanner = await RepoScanner.open(meta.path)
    return { files: await scanner.fileTree() }
  })

  // 提交通关结果
  app.post<{ Params: { id: string } }>('/api/projects/:id/progress/level', async (req, reply) => {
    const body = LevelDoneBodySchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: body.error.message })
    const store = new ProjectStore(req.params.id)
    const course = await store.readCourse()
    if (!course) return reply.code(404).send({ error: '课程不存在' })
    const progress: Progress = (await store.readProgress()) ?? emptyProgress()
    const prev = progress.completedLevels[body.data.levelId]
    const { progress: applied, newBadges } = applyLevelResult(progress, course, body.data)
    // 重复通关不重复累计 XP:总 XP 只补发比上次更高的差额(允许刷成绩,防刷分)
    const next = prev
      ? { ...applied, xp: progress.xp + Math.max(0, body.data.result.xp - prev.xp) }
      : applied
    await store.writeProgress(next)
    return { progress: next, newBadges }
  })

  // 记录文件阅读(考古学家徽章用)
  app.post<{ Params: { id: string } }>('/api/projects/:id/progress/file-read', async (req, reply) => {
    const body = FileReadBodySchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: body.error.message })
    const store = new ProjectStore(req.params.id)
    const progress: Progress = (await store.readProgress()) ?? emptyProgress()
    if (!progress.filesRead.includes(body.data.file)) {
      progress.filesRead = [...progress.filesRead, body.data.file]
      await store.writeProgress(progress)
    }
    return { progress }
  })

  // 生产托管:存在 web 构建产物时,静态托管 + SPA 回退(非 /api 路由回 index.html)
  const distPath = opts.webDist === undefined ? defaultWebDist() : opts.webDist
  if (distPath && fs.existsSync(path.join(distPath, 'index.html'))) {
    await app.register(fastifyStatic, { root: distPath })
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api')) {
        return reply.sendFile('index.html')
      }
      return reply.code(404).send({ error: '未找到' })
    })
  }

  return app
}
