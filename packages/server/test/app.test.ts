import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { MockProvider, type GenerateOptions } from '../src/providers.js'
import { commitChange, makeDataHome, makeFixtureRepo } from './helpers.js'

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
  for (let i = 0; i < 100; i++) {
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
    expect(res.json()).toEqual({ available: true, name: 'mock' })
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
      payload: { levelId: 'lv-auth', result: { rating: 'S', accuracy: 1, maxCombo: 2, xp: 35 }, taskCount: 2 },
    })).json()
    expect(done.progress.xp).toBe(35)
    expect(done.newBadges).toContain('first-level')

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

  it('重复导入同一路径复用同一项目', async () => {
    const a = await app()
    const r1 = (await a.inject({ method: 'POST', url: '/api/projects', payload: { path: repo } })).json()
    await waitForDone(a, r1.id)
    const r2 = (await a.inject({ method: 'POST', url: '/api/projects', payload: { path: repo } })).json()
    expect(r2.id).toBe(r1.id)
    const list = (await a.inject({ method: 'GET', url: '/api/projects' })).json()
    expect(list.projects).toHaveLength(1)
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
