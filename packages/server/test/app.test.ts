import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { MockProvider, type GenerateOptions } from '../src/providers.js'
import { commitChange, makeDataHome, makeFixtureRepo } from './helpers.js'
import { ProjectStore, projectIdFor } from '../src/store.js'
import { emptyProgress } from '@sourcerealm/shared'

const courseDraft = {
  projectName: 'demo',
  tagline: '一段奇妙的源码之旅',
  chapters: [{
    id: 'ch1', title: '初入江湖', intro: '了解项目全貌',
    levels: [{ id: 'lv-auth', title: '登录大门', goal: '读懂 login', files: ['src/auth.js'] }],
  }],
}
const levelDraft = {
  title: '登录大门', summary: 's',
  tasks: [{
    id: 't1', type: 'quiz', narrative: 'n', question: 'q', options: ['a', 'b'], answer: [0],
    explanation: 'e', refs: [{ file: 'src/auth.js', startLine: 1, endLine: 4, contentHash: '' }],
  }, {
    id: 't2', type: 'code-type', narrative: 'n', explanation: 'e',
    ref: { file: 'src/auth.js', startLine: 6, endLine: 8, contentHash: '' },
  }],
}

async function waitForDone(app: Awaited<ReturnType<typeof buildApp>>, id: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const res = await app.inject({ method: 'GET', url: `/api/projects/${id}` })
    if (res.json().meta.generation.status === 'done') return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('生成超时')
}

describe('HTTP API', () => {
  let repo: string
  beforeEach(async () => {
    await makeDataHome()
    repo = await makeFixtureRepo()
  })

  function app() {
    return buildApp({
      provider: new MockProvider((opts: GenerateOptions<unknown>) =>
        opts.schemaName === 'course' ? courseDraft : levelDraft,
      ),
    })
  }

  it('导入不存在的路径返回 400', async () => {
    const a = await app()
    const res = await a.inject({ method: 'POST', url: '/api/projects', payload: { path: '/no/such' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('不是有效目录')
  })

  it('GET /api/provider 返回当前 Provider 信息', async () => {
    const a = await app()
    const res = await a.inject({ method: 'GET', url: '/api/provider' })
    expect(res.statusCode).toBe(200)
    // mode 由 SOURCEREALM_USE_CLI 推断(测试未设置 → 'unset');provider 由测试注入为 mock
    expect(res.json()).toMatchObject({ available: true, name: 'mock' })
    expect(res.json()).toHaveProperty('mode')
  })

  it('POST /api/system/pick-directory 返回系统目录选择结果', async () => {
    const a = await buildApp({
      provider: new MockProvider((opts: GenerateOptions<unknown>) =>
        opts.schemaName === 'course' ? courseDraft : levelDraft,
      ),
      directoryPicker: async () => repo,
    })
    const res = await a.inject({ method: 'POST', url: '/api/system/pick-directory' })
    expect(res.statusCode).toBe(200)
    expect(res.json().path).toBe(repo)
  })

  it('GET /api/provider 在 API 模式返回订阅/API 地址', async () => {
    const savedFlag = process.env.SOURCEREALM_USE_CLI
    const savedBase = process.env.ANTHROPIC_BASE_URL
    process.env.SOURCEREALM_USE_CLI = 'false'
    process.env.ANTHROPIC_BASE_URL = 'https://relay.example.com'
    try {
      const a = await app()
      const res = await a.inject({ method: 'GET', url: '/api/provider' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({
        mode: 'anthropic-api',
        apiBaseUrl: 'https://relay.example.com',
        apiBaseUrlSource: 'env',
      })
    } finally {
      if (savedFlag === undefined) delete process.env.SOURCEREALM_USE_CLI
      else process.env.SOURCEREALM_USE_CLI = savedFlag
      if (savedBase === undefined) delete process.env.ANTHROPIC_BASE_URL
      else process.env.ANTHROPIC_BASE_URL = savedBase
    }
  })

  it('GET /api/provider 按实际 Provider 名称补充 API 地址', async () => {
    const savedFlag = process.env.SOURCEREALM_USE_CLI
    const savedBase = process.env.ANTHROPIC_BASE_URL
    delete process.env.SOURCEREALM_USE_CLI
    process.env.ANTHROPIC_BASE_URL = 'https://relay-by-provider.example.com'
    try {
      const a = await buildApp({
        provider: {
          name: 'anthropic-api',
          async generate(opts) {
            return opts.schema.parse(levelDraft)
          },
        },
      })
      const res = await a.inject({ method: 'GET', url: '/api/provider' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({
        mode: 'unset',
        name: 'anthropic-api',
        apiBaseUrl: 'https://relay-by-provider.example.com',
        apiBaseUrlSource: 'env',
      })
    } finally {
      if (savedFlag === undefined) delete process.env.SOURCEREALM_USE_CLI
      else process.env.SOURCEREALM_USE_CLI = savedFlag
      if (savedBase === undefined) delete process.env.ANTHROPIC_BASE_URL
      else process.env.ANTHROPIC_BASE_URL = savedBase
    }
  })

  it('导入 → 自动生成 → 读课程与关卡 → 读源码 → 提交通关', async () => {
    const a = await app()
    const imported = await a.inject({ method: 'POST', url: '/api/projects', payload: { path: repo } })
    expect(imported.statusCode).toBe(200)
    const { id } = imported.json()
    await waitForDone(a, id)

    const project = (await a.inject({ method: 'GET', url: `/api/projects/${id}` })).json()
    expect(project.course.chapters[0].levels[0].status).toBe('ready')
    expect(project.progress.xp).toBe(0)

    const levelRes = (await a.inject({ method: 'GET', url: `/api/projects/${id}/levels/lv-auth` })).json()
    expect(levelRes.level.tasks).toHaveLength(2)
    expect(levelRes.freshness.t1).toBe(true)

    const file = (await a.inject({
      method: 'GET', url: `/api/projects/${id}/file?path=${encodeURIComponent('src/auth.js')}`,
    })).json()
    expect(file.content).toContain('function login')

    const done = (await a.inject({
      method: 'POST', url: `/api/projects/${id}/progress/level`,
      payload: {
        levelId: 'lv-auth',
        result: {
          rating: 'S', accuracy: 1, maxCombo: 2, xp: 35,
          answeredHistory: [{ taskIndex: 0, taskId: 't1', correct: true, explanation: 'e' }],
        },
        taskCount: 2,
      },
    })).json()
    expect(done.progress.xp).toBe(35)
    expect(done.newBadges).toContain('first-level')
    // answeredHistory 随完成记录持久化,供再次进入只读回顾
    expect(done.progress.completedLevels['lv-auth'].answeredHistory).toHaveLength(1)
    const afterDone = (await a.inject({ method: 'GET', url: `/api/projects/${id}` })).json()
    expect(afterDone.progress.completedLevels['lv-auth'].answeredHistory[0].taskId).toBe('t1')

    const read = (await a.inject({
      method: 'POST', url: `/api/projects/${id}/progress/file-read`, payload: { file: 'src/auth.js' },
    })).json()
    expect(read.progress.filesRead).toContain('src/auth.js')

    // 重复通关不重复累计 XP,只补发更高成绩的差额
    const again = (await a.inject({
      method: 'POST', url: `/api/projects/${id}/progress/level`,
      payload: { levelId: 'lv-auth', result: { rating: 'S', accuracy: 1, maxCombo: 2, xp: 35 }, taskCount: 2 },
    })).json()
    expect(again.progress.xp).toBe(35)
    const better = (await a.inject({
      method: 'POST', url: `/api/projects/${id}/progress/level`,
      payload: { levelId: 'lv-auth', result: { rating: 'S', accuracy: 1, maxCombo: 2, xp: 50 }, taskCount: 2 },
    })).json()
    expect(better.progress.xp).toBe(50)
  })

  it('保存、读取、删除关卡断点,通关后清理断点', async () => {
    const a = await app()
    const id = projectIdFor(repo)
    const store = new ProjectStore(id)
    await store.writeMeta({
      id,
      path: repo,
      name: 'demo',
      isGit: true,
      anchorCommit: null,
      createdAt: '2026-06-16T00:00:00.000Z',
      generation: { status: 'done' },
    })
    await store.writeProgress(emptyProgress())
    await store.writeCourse({
      projectName: 'demo',
      tagline: '一段奇妙的源码之旅',
      chapters: [{
        id: 'ch1',
        title: '初入江湖',
        intro: '了解项目全貌',
        levels: [{ id: 'lv-auth', title: '登录大门', goal: '读懂 login', files: ['src/auth.js'], status: 'ready' }],
      }],
    })
    const savedRun = {
      levelId: 'lv-auth',
      taskIndex: 1,
      hearts: 2,
      combo: 1,
      maxCombo: 1,
      xpEarned: 10,
      wrongAnswers: 1,
      totalAnswers: 2,
      scoredTaskCount: 1,
      phase: 'feedback',
      lastCorrect: false,
      answeredHistory: [{ taskIndex: 0, taskId: 't1', correct: true, explanation: 'e' }],
      updatedAt: '2026-06-16T00:00:00.000Z',
    }

    const save = await a.inject({
      method: 'PUT',
      url: `/api/projects/${id}/progress/level-run`,
      payload: savedRun,
    })
    expect(save.statusCode).toBe(200)
    expect(save.json().progress.levelRuns['lv-auth'].taskIndex).toBe(1)
    expect((await a.inject({ method: 'GET', url: `/api/projects/${id}` })).json().progress.levelRuns['lv-auth']).toBeTruthy()

    const del = await a.inject({ method: 'DELETE', url: `/api/projects/${id}/progress/level-run/lv-auth` })
    expect(del.statusCode).toBe(200)
    expect(del.json().progress.levelRuns['lv-auth']).toBeUndefined()

    await a.inject({
      method: 'PUT',
      url: `/api/projects/${id}/progress/level-run`,
      payload: savedRun,
    })
    const done = await a.inject({
      method: 'POST',
      url: `/api/projects/${id}/progress/level`,
      payload: { levelId: 'lv-auth', result: { rating: 'S', accuracy: 1, maxCombo: 2, xp: 35 }, taskCount: 2 },
    })
    expect(done.statusCode).toBe(200)
    expect(done.json().progress.levelRuns['lv-auth']).toBeUndefined()
  })

  it('重复导入同一路径复用同一项目', async () => {
    const a = await app()
    const r1 = (await a.inject({ method: 'POST', url: '/api/projects', payload: { path: repo } })).json()
    await waitForDone(a, r1.id)
    const r2 = (await a.inject({ method: 'POST', url: '/api/projects', payload: { path: repo } })).json()
    expect(r2.id).toBe(r1.id)
    const list = (await a.inject({ method: 'GET', url: '/api/projects' })).json()
    expect(list.projects).toHaveLength(1)
  })

  it('POST generate:重试失败关卡时先写入 generating,避免前端读到旧 done', async () => {
    let levelAttempts = 0
    let releaseRetry!: () => void
    const retryStarted = new Promise<void>((resolve) => {
      releaseRetry = resolve
    })
    const a = await buildApp({
      provider: new MockProvider(async (opts: GenerateOptions<unknown>) => {
        if (opts.schemaName === 'course') return courseDraft
        levelAttempts++
        if (levelAttempts <= 3) throw new Error('first level failure')
        await retryStarted
        return levelDraft
      }),
    })
    const { id } = (await a.inject({ method: 'POST', url: '/api/projects', payload: { path: repo } })).json()
    await waitForDone(a, id)

    const failedProject = (await a.inject({ method: 'GET', url: `/api/projects/${id}` })).json()
    expect(failedProject.meta.generation.status).toBe('done')
    expect(failedProject.course.chapters[0].levels[0].status).toBe('failed')

    const retry = await a.inject({ method: 'POST', url: `/api/projects/${id}/generate` })
    expect(retry.statusCode).toBe(200)
    const retryingProject = (await a.inject({ method: 'GET', url: `/api/projects/${id}` })).json()
    expect(retryingProject.meta.generation.status).toBe('generating')
    expect(retryingProject.course.chapters[0].levels[0].status).not.toBe('failed')

    releaseRetry()
    await waitForDone(a, id)
    const doneProject = (await a.inject({ method: 'GET', url: `/api/projects/${id}` })).json()
    expect(doneProject.course.chapters[0].levels[0].status).toBe('ready')
  })

  it('update-check:刚生成无新提交 → changed=false', async () => {
    const a = await app()
    const { id } = (await a.inject({ method: 'POST', url: '/api/projects', payload: { path: repo } })).json()
    await waitForDone(a, id)
    const res = await a.inject({ method: 'GET', url: `/api/projects/${id}/update-check` })
    expect(res.statusCode).toBe(200)
    expect(res.json().changed).toBe(false)
  })

  it('update-check:修改文件后 → changed=true, modified===1', async () => {
    const a = await app()
    const { id } = (await a.inject({ method: 'POST', url: '/api/projects', payload: { path: repo } })).json()
    await waitForDone(a, id)
    await commitChange(repo, { 'src/auth.js': 'function login() { return 42 }\n' }, 'modify auth')
    const res = await a.inject({ method: 'GET', url: `/api/projects/${id}/update-check` })
    const body = res.json()
    expect(body.changed).toBe(true)
    expect(body.summary.modified).toBe(1)
  })

  it('POST update:修订受影响关卡,锚点前进,再 check changed=false', async () => {
    // 修订 mock:出题阶段针对新 auth.js(单行)出引用第 1 行的题
    const reviseLevelDraft = {
      title: '登录大门(已更新)', summary: '新版 login',
      tasks: [{
        id: 't1', type: 'quiz', narrative: 'n', question: 'q', options: ['a', 'b'], answer: [0],
        explanation: 'e', refs: [{ file: 'src/auth.js', startLine: 1, endLine: 1, contentHash: '' }],
      }, {
        id: 't2', type: 'code-type', narrative: 'n', explanation: 'e',
        ref: { file: 'src/auth.js', startLine: 1, endLine: 1, contentHash: '' },
      }],
    }
    const a = await buildApp({
      provider: new MockProvider((opts: GenerateOptions<unknown>) => {
        if (opts.schemaName === 'course') return courseDraft
        if (opts.schemaName === 'level' && opts.prompt.includes('维护者')) return reviseLevelDraft
        return levelDraft
      }),
    })
    const { id } = (await a.inject({ method: 'POST', url: '/api/projects', payload: { path: repo } })).json()
    await waitForDone(a, id)

    const hashBefore = (await a.inject({ method: 'GET', url: `/api/projects/${id}/levels/lv-auth` }))
      .json().level.tasks[0].refs[0].contentHash
    const oldAnchor = (await a.inject({ method: 'GET', url: `/api/projects/${id}` })).json().meta.anchorCommit

    await commitChange(repo, { 'src/auth.js': 'function login() { return 42 }\n' }, 'modify auth')

    const upd = await a.inject({ method: 'POST', url: `/api/projects/${id}/update` })
    expect(upd.statusCode).toBe(200)
    expect(upd.json().ok).toBe(true)

    // 轮询直到 anchorCommit 前进到新 head(更新完成;避开初始 done 的竞态)
    let newHead = ''
    for (let i = 0; i < 100; i++) {
      const project = (await a.inject({ method: 'GET', url: `/api/projects/${id}` })).json()
      if (project.meta.anchorCommit !== oldAnchor && project.meta.generation.status === 'done') {
        newHead = project.meta.anchorCommit
        break
      }
      await new Promise((r) => setTimeout(r, 50))
    }
    expect(newHead).toBeTruthy()

    const lvAfter = (await a.inject({ method: 'GET', url: `/api/projects/${id}/levels/lv-auth` })).json()
    expect(lvAfter.level.title).toBe('登录大门(已更新)')
    expect(lvAfter.level.tasks[0].refs[0].contentHash).not.toBe(hashBefore)

    // update-check 再次检测:已无变更(anchor 已为新 head)
    const recheck = (await a.inject({ method: 'GET', url: `/api/projects/${id}/update-check` })).json()
    expect(recheck.changed).toBe(false)
  })

  it('POST update:非 git 项目 → 400', async () => {
    const a = await app()
    // 非 git 目录 fixture:mkdtemp + 一个文件
    const nonGit = await fs.mkdtemp(path.join(os.tmpdir(), 'cq-nongit-'))
    await fs.writeFile(path.join(nonGit, 'a.txt'), 'hello\n')
    const { id } = (await a.inject({ method: 'POST', url: '/api/projects', payload: { path: nonGit } })).json()
    const res = await a.inject({ method: 'POST', url: `/api/projects/${id}/update` })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('非 git')
  })
})
