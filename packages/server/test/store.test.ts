import { promises as fs } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectStore, dataRoot, projectIdFor } from '../src/store.js'
import { emptyProgress } from '@sourcerealm/shared'
import type { Level, ProjectMeta } from '@sourcerealm/shared'
import { makeDataHome } from './helpers.js'

const meta: ProjectMeta = {
  id: 'abc123', path: '/tmp/demo', name: 'demo', isGit: true,
  anchorCommit: 'deadbeef', createdAt: '2025-06-10T00:00:00Z',
  generation: { status: 'idle' },
}

const level: Level = {
  id: 'lv1', chapterId: 'ch1', title: 't', summary: 's', files: ['a.js'], status: 'ready',
  tasks: [{
    id: 't1', type: 'quiz', narrative: 'n', explanation: 'e', question: 'q',
    options: ['a', 'b'], answer: [0], refs: [],
  }],
}

describe('ProjectStore', () => {
  beforeEach(async () => {
    await makeDataHome()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('projectIdFor 对同一路径稳定', () => {
    expect(projectIdFor('/tmp/demo')).toBe(projectIdFor('/tmp/demo'))
    expect(projectIdFor('/tmp/demo')).toHaveLength(12)
  })

  it('SOURCEREALM_HOME 留空时回退到启动目录下的 .sourcerealm', () => {
    const savedInitCwd = process.env.INIT_CWD
    process.env.SOURCEREALM_HOME = ''
    process.env.INIT_CWD = path.join(process.cwd(), 'demo-root')
    try {
      expect(dataRoot()).toBe(path.join(process.cwd(), 'demo-root', '.sourcerealm'))
    } finally {
      if (savedInitCwd === undefined) delete process.env.INIT_CWD
      else process.env.INIT_CWD = savedInitCwd
    }
  })

  it('meta/course/progress/level 读写往返', async () => {
    const store = new ProjectStore('abc123')
    expect(await store.readMeta()).toBeNull()
    await store.writeMeta(meta)
    expect((await store.readMeta())!.name).toBe('demo')

    await store.writeProgress(emptyProgress())
    expect((await store.readProgress())!.xp).toBe(0)

    await store.writeLevel(level)
    expect((await store.readLevel('lv1'))!.tasks).toHaveLength(1)
    expect(await store.readLevel('nope')).toBeNull()
  })

  it('rename 短暂 EPERM 时会重试并清理临时文件', async () => {
    const originalRename = fs.rename.bind(fs)
    let calls = 0
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      calls++
      if (calls === 1) {
        throw Object.assign(new Error('locked'), { code: 'EPERM' })
      }
      return originalRename(from, to)
    })

    const store = new ProjectStore('abc123')
    await store.writeMeta(meta)

    expect(calls).toBe(2)
    expect((await store.readMeta())!.name).toBe('demo')
    const files = await fs.readdir(store.dir)
    expect(files.filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('rename 持续失败时抛出原错误并清理本次临时文件', async () => {
    vi.spyOn(fs, 'rename').mockRejectedValue(Object.assign(new Error('locked'), { code: 'EPERM' }))

    const store = new ProjectStore('abc123')
    await expect(store.writeMeta(meta)).rejects.toThrow('locked')

    const files = await fs.readdir(store.dir)
    expect(files.filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('并发写同一个 JSON 时按目标文件串行落盘', async () => {
    const store = new ProjectStore('abc123')
    await Promise.all(
      Array.from({ length: 6 }, (_, index) => store.writeMeta({ ...meta, name: `demo-${index}` })),
    )

    const saved = await store.readMeta()
    expect(saved?.name).toMatch(/^demo-\d$/)
    expect(saved?.id).toBe('abc123')
  })

  it('写入不合 schema 的数据直接抛错', async () => {
    const store = new ProjectStore('abc123')
    await expect(store.writeMeta({ bad: true } as never)).rejects.toThrow()
  })

  it('list 列出全部项目', async () => {
    const store = new ProjectStore('abc123')
    await store.writeMeta(meta)
    const all = await ProjectStore.list()
    expect(all.map((m) => m.id)).toContain('abc123')
  })
})
