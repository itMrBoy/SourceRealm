import { beforeEach, describe, expect, it } from 'vitest'
import { LevelGenerator, readConcurrency, runWithConcurrency } from '../src/generator.js'
import { MockProvider } from '../src/providers.js'
import { RepoScanner } from '../src/scanner.js'
import { ProjectStore, projectIdFor } from '../src/store.js'
import { makeDataHome, makeFixtureRepo } from './helpers.js'
import type { GenerateOptions } from '../src/providers.js'

const courseDraft = {
  projectName: 'demo',
  tagline: '一段奇妙的源码之旅',
  chapters: [{
    id: 'ch1', title: '初入江湖', intro: '了解项目全貌',
    levels: [{ id: 'lv-auth', title: '登录大门', goal: '读懂 login 函数', files: ['src/auth.js', 'ghost.js'] }],
  }],
}

const levelDraft = {
  title: '登录大门', summary: '走进 login 的世界',
  tasks: [
    {
      id: 't1', type: 'quiz', narrative: '勇者你好!', question: 'login 失败时会怎样?',
      options: ['抛出异常', '返回 null'], answer: [0], explanation: '没有 user 会 throw',
      refs: [{ file: 'src/auth.js', startLine: 1, endLine: 4, contentHash: '' }],
    },
    {
      id: 't2', type: 'treasure-hunt', narrative: '寻宝时间!', instruction: '找到 token 函数', hint: '在下半部分',
      explanation: 'token 负责签发', target: { file: 'src/auth.js', startLine: 6, endLine: 8, contentHash: '' },
    },
    {
      id: 't3', type: 'quiz', narrative: '幽灵题', question: 'q?', options: ['a', 'b'], answer: [0],
      explanation: 'e', refs: [{ file: 'ghost.js', startLine: 1, endLine: 2, contentHash: '' }],
    },
  ],
}

function mockProvider() {
  return new MockProvider((opts: GenerateOptions<unknown>) =>
    opts.schemaName === 'course' ? courseDraft : levelDraft,
  )
}

describe('readConcurrency', () => {
  it('合法正整数生效,非法/缺失回落默认 3', () => {
    expect(readConcurrency({ SOURCEREALM_CONCURRENCY: '5' } as NodeJS.ProcessEnv)).toBe(5)
    expect(readConcurrency({ SOURCEREALM_CONCURRENCY: '1' } as NodeJS.ProcessEnv)).toBe(1)
    expect(readConcurrency({} as NodeJS.ProcessEnv)).toBe(3)
    expect(readConcurrency({ SOURCEREALM_CONCURRENCY: '0' } as NodeJS.ProcessEnv)).toBe(3)
    expect(readConcurrency({ SOURCEREALM_CONCURRENCY: 'abc' } as NodeJS.ProcessEnv)).toBe(3)
  })
})

describe('runWithConcurrency', () => {
  it('同序返回结果,且同时进行数不超过 limit', async () => {
    let active = 0
    let peak = 0
    const items = [1, 2, 3, 4, 5, 6]
    const out = await runWithConcurrency(items, 2, async (n) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 10))
      active--
      return n * 2
    })
    expect(out).toEqual([2, 4, 6, 8, 10, 12])
    expect(peak).toBeLessThanOrEqual(2)
  })
})

describe('LevelGenerator', () => {
  let repo: string
  beforeEach(async () => {
    await makeDataHome()
    repo = await makeFixtureRepo()
  })

  async function setup() {
    const scanner = await RepoScanner.open(repo)
    const store = new ProjectStore(projectIdFor(repo))
    await store.writeMeta({
      id: store.id, path: repo, name: 'demo', isGit: true,
      anchorCommit: await scanner.head(), createdAt: new Date().toISOString(),
      generation: { status: 'idle' },
    })
    return { scanner, store }
  }

  it('完整生成:课程落盘、关卡落盘、hash 回填、造假引用剔除、事件齐全', async () => {
    const { scanner, store } = await setup()
    const gen = new LevelGenerator(store, scanner, mockProvider())
    const events: string[] = []
    gen.on('event', (e: { type: string }) => events.push(e.type))
    await gen.run()

    const course = (await store.readCourse())!
    // 测绘结果:不存在的 ghost.js 已从 files 中剔除
    expect(course.chapters[0].levels[0].files).toEqual(['src/auth.js'])
    expect(course.chapters[0].levels[0].status).toBe('ready')

    const level = (await store.readLevel('lv-auth'))!
    // 引用 ghost.js 的 t3 被剔除,t1/t2 保留且 hash 已回填
    expect(level.tasks.map((t) => t.id)).toEqual(['t1', 't2'])
    const t1 = level.tasks[0]
    expect(t1.type === 'quiz' && t1.refs[0].contentHash).toMatch(/^[0-9a-f]{16}$/)
    expect(level.files).toEqual(['src/auth.js'])

    expect(events).toContain('course')
    expect(events).toContain('level')
    expect(events).toContain('done')
    expect((await store.readMeta())!.generation.status).toBe('done')
  })

  it('断点续跑:已 ready 的关卡不重新生成', async () => {
    const { scanner, store } = await setup()
    await new LevelGenerator(store, scanner, mockProvider()).run()

    let calls = 0
    const counting = new MockProvider(() => { calls++; return levelDraft })
    await new LevelGenerator(store, scanner, counting).run()
    expect(calls).toBe(0) // 课程已存在 + 关卡已 ready,无需任何 LLM 调用
  })

  it('单关生成失败不阻塞整体,状态标记 failed', async () => {
    const { scanner, store } = await setup()
    const broken = new MockProvider((opts: GenerateOptions<unknown>) => {
      if (opts.schemaName === 'course') return courseDraft
      throw new Error('boom')
    })
    const gen = new LevelGenerator(store, scanner, broken)
    await gen.run()
    const course = (await store.readCourse())!
    expect(course.chapters[0].levels[0].status).toBe('failed')
    expect((await store.readMeta())!.generation.status).toBe('done')
  })

  it('出题 prompt 注入整体课程大纲(关卡分工递进),且不内嵌大段源码', async () => {
    const { scanner, store } = await setup()
    let levelPrompt = ''
    const capturing = new MockProvider((opts: GenerateOptions<unknown>) => {
      if (opts.schemaName === 'course') return courseDraft
      levelPrompt = opts.prompt
      return levelDraft
    })
    await new LevelGenerator(store, scanner, capturing).run()
    // 含课程大纲(其它关卡 title/goal),保证 LLM 知道全局分工
    expect(levelPrompt).toContain('整体课程大纲')
    expect(levelPrompt).toContain('读懂 login 函数') // 来自大纲的 goal
    // 不再把整段源码(行号块)塞进基础 prompt
    expect(levelPrompt).not.toContain('1| function login')
  })

  it('SDK 路径:buildEmbeddedContext 被调用,返回行号源码块', async () => {
    const { scanner, store } = await setup()
    let embedded = ''
    // 模拟 SDK provider:消费 buildEmbeddedContext(CLI provider 则不会调用它)
    const sdkLike = new MockProvider(async (opts: GenerateOptions<unknown>) => {
      if (opts.schemaName === 'course') {
        await opts.buildEmbeddedContext?.()
        return courseDraft
      }
      embedded = (await opts.buildEmbeddedContext?.()) ?? ''
      return levelDraft
    })
    await new LevelGenerator(store, scanner, sdkLike).run()
    expect(embedded).toContain('=== src/auth.js ===')
    expect(embedded).toMatch(/1\| function login/)
  })

  it('并发受 SOURCEREALM_CONCURRENCY 限制,且并发完成后数据一致', async () => {
    process.env.SOURCEREALM_CONCURRENCY = '2'
    // 构造 5 关课程(每章 ≤4 关,故拆成两章满足 CourseDraftSchema)
    const bigCourse = {
      projectName: 'demo',
      tagline: 't',
      chapters: [
        {
          id: 'ch1', title: '章节一', intro: 'i1',
          levels: Array.from({ length: 3 }, (_, i) => ({
            id: `lv${i}`, title: `关${i}`, goal: `目标${i}`, files: ['src/auth.js'],
          })),
        },
        {
          id: 'ch2', title: '章节二', intro: 'i2',
          levels: Array.from({ length: 2 }, (_, i) => ({
            id: `lv${i + 3}`, title: `关${i + 3}`, goal: `目标${i + 3}`, files: ['src/auth.js'],
          })),
        },
      ],
    }
    let active = 0
    let peak = 0
    const concurrent = new MockProvider(async (opts: GenerateOptions<unknown>) => {
      if (opts.schemaName === 'course') return bigCourse
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 20))
      active--
      return levelDraft
    })
    const { scanner, store } = await setup()
    await new LevelGenerator(store, scanner, concurrent).run()
    delete process.env.SOURCEREALM_CONCURRENCY

    expect(peak).toBeLessThanOrEqual(2) // 并发上限生效
    const course = (await store.readCourse())!
    // 5 关全部 ready,course 写盘无竞态丢更新
    const allLevels = course.chapters.flatMap((c) => c.levels)
    expect(allLevels.every((l) => l.status === 'ready')).toBe(true)
    for (let i = 0; i < 5; i++) {
      expect(await store.readLevel(`lv${i}`)).not.toBeNull()
    }
  })
})
