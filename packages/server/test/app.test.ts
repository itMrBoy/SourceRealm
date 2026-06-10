import { beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { MockProvider, type GenerateOptions } from '../src/providers.js'
import { makeDataHome, makeFixtureRepo } from './helpers.js'

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
})
