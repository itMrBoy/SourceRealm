import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
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
