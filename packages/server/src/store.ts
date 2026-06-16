import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { z } from 'zod'
import {
  CourseSchema,
  LevelSchema,
  ProgressSchema,
  ProjectMetaSchema,
  type Course,
  type Level,
  type Progress,
  type ProjectMeta,
} from '@sourcerealm/shared'

const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RENAME_RETRY_DELAYS_MS = [25, 50, 100, 200, 400, 800]
const writeQueues = new Map<string, Promise<void>>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function queueKey(target: string): string {
  const resolved = path.resolve(target)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

async function queuedTargetWrite(target: string, fn: () => Promise<void>): Promise<void> {
  const key = queueKey(target)
  const previous = writeQueues.get(key) ?? Promise.resolve()
  const run = previous.then(fn)
  const settled = run.catch(() => {})
  writeQueues.set(key, settled)
  settled.finally(() => {
    if (writeQueues.get(key) === settled) writeQueues.delete(key)
  })
  return run
}

async function renameWithRetry(source: string, target: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(source, target)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      const delay = RENAME_RETRY_DELAYS_MS[attempt]
      if (!code || !RENAME_RETRY_CODES.has(code) || delay === undefined) throw err
      await sleep(delay)
    }
  }
}

export function dataRoot(): string {
  const configured = process.env.SOURCEREALM_HOME?.trim()
  const defaultBase = process.env.INIT_CWD?.trim() || process.cwd()
  return configured ? path.resolve(configured) : path.resolve(defaultBase, '.sourcerealm')
}

export function projectIdFor(repoPath: string): string {
  return createHash('sha256').update(path.resolve(repoPath)).digest('hex').slice(0, 12)
}

export class ProjectStore {
  constructor(readonly id: string) {}

  get dir(): string {
    return path.join(dataRoot(), this.id)
  }

  private async readJson<T>(file: string, schema: z.ZodType<T>): Promise<T | null> {
    try {
      const raw = await fs.readFile(path.join(this.dir, file), 'utf8')
      return schema.parse(JSON.parse(raw))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  /** 原子写:先写临时文件再 rename */
  private async writeJson<T>(file: string, schema: z.ZodType<T>, value: T): Promise<void> {
    const parsed = schema.parse(value)
    const target = path.join(this.dir, file)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await queuedTargetWrite(target, async () => {
      const tmp = `${target}.${randomUUID()}.tmp`
      try {
        await fs.writeFile(tmp, JSON.stringify(parsed, null, 2))
        await renameWithRetry(tmp, target)
      } catch (err) {
        await fs.rm(tmp, { force: true }).catch(() => {})
        throw err
      }
    })
  }

  readMeta() { return this.readJson('project.json', ProjectMetaSchema) }
  writeMeta(v: ProjectMeta) { return this.writeJson('project.json', ProjectMetaSchema, v) }
  readCourse() { return this.readJson('course.json', CourseSchema) }
  writeCourse(v: Course) { return this.writeJson('course.json', CourseSchema, v) }
  readProgress(): Promise<Progress | null> { return this.readJson('progress.json', ProgressSchema) as Promise<Progress | null> }
  writeProgress(v: Progress) { return this.writeJson('progress.json', ProgressSchema, v) }
  readLevel(id: string) { return this.readJson(path.join('levels', `${id}.json`), LevelSchema) }
  writeLevel(v: Level) { return this.writeJson(path.join('levels', `${v.id}.json`), LevelSchema, v) }

  /** 增量更新:把关卡先写到 levels-next/ 暂存,全部成功后再原子提升 */
  writeLevelNext(v: Level) { return this.writeJson(path.join('levels-next', `${v.id}.json`), LevelSchema, v) }

  /** 把 levels-next/*.json 覆盖移动到 levels/,然后删除 levels-next 目录 */
  async promoteNextLevels(): Promise<void> {
    const nextDir = path.join(this.dir, 'levels-next')
    const levelsDir = path.join(this.dir, 'levels')
    let entries: string[]
    try {
      entries = await fs.readdir(nextDir)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
    await fs.mkdir(levelsDir, { recursive: true })
    for (const name of entries) {
      if (!name.endsWith('.json')) continue
      const target = path.join(levelsDir, name)
      await queuedTargetWrite(target, () => renameWithRetry(path.join(nextDir, name), target))
    }
    await fs.rm(nextDir, { recursive: true, force: true })
  }

  /** 清理暂存目录(更新失败回滚) */
  async clearNextLevels(): Promise<void> {
    await fs.rm(path.join(this.dir, 'levels-next'), { recursive: true, force: true })
  }

  static async list(): Promise<ProjectMeta[]> {
    let ids: string[]
    try {
      ids = await fs.readdir(dataRoot())
    } catch {
      return []
    }
    const metas = await Promise.all(ids.map((id) => new ProjectStore(id).readMeta().catch(() => null)))
    return metas.filter((m): m is ProjectMeta => m !== null)
  }
}
