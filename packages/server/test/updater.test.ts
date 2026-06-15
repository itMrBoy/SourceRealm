import { promises as fs } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Course, Level, Progress } from '@sourcerealm/shared'
import { RepoScanner } from '../src/scanner.js'
import { LevelGenerator } from '../src/generator.js'
import { MockProvider, type GenerateOptions } from '../src/providers.js'
import { ProjectStore, projectIdFor } from '../src/store.js'
import { CourseUpdater } from '../src/updater.js'
import {
  diffSince,
  analyzeImpact,
  NEW_FILES_THRESHOLD,
  type RepoDiff,
} from '../src/updater.js'
import { makeDataHome, makeFixtureRepo, commitChange, AUTH_JS } from './helpers.js'

async function head(scanner: RepoScanner): Promise<string> {
  const h = await scanner.head()
  if (!h) throw new Error('no head')
  return h
}

describe('diffSince', () => {
  it('检出被修改的文件', async () => {
    const dir = await makeFixtureRepo()
    const scanner = await RepoScanner.open(dir)
    const anchor = await head(scanner)
    await commitChange(dir, { 'src/auth.js': 'function login() { return 42 }\n' }, 'modify auth')
    const diff = await diffSince(scanner, anchor)
    expect(diff.modified).toContain('src/auth.js')
    expect(diff.deleted).toEqual([])
    expect(diff.added).toEqual([])
  })

  it('检出被删除的文件', async () => {
    const dir = await makeFixtureRepo()
    const scanner = await RepoScanner.open(dir)
    const anchor = await head(scanner)
    await commitChange(dir, { 'README.md': null }, 'delete readme')
    const diff = await diffSince(scanner, anchor)
    expect(diff.deleted).toContain('README.md')
    expect(diff.modified).toEqual([])
    expect(diff.added).toEqual([])
  })

  it('检出新增的文件', async () => {
    const dir = await makeFixtureRepo()
    const scanner = await RepoScanner.open(dir)
    const anchor = await head(scanner)
    await commitChange(
      dir,
      { 'src/a.js': 'a\n', 'src/b.js': 'b\n', 'src/c.js': 'c\n' },
      'add three',
    )
    const diff = await diffSince(scanner, anchor)
    expect(diff.added).toEqual(expect.arrayContaining(['src/a.js', 'src/b.js', 'src/c.js']))
    expect(diff.added).toHaveLength(3)
    expect(diff.modified).toEqual([])
    expect(diff.deleted).toEqual([])
  })

  it('空 diff 返回空数组', async () => {
    const dir = await makeFixtureRepo()
    const scanner = await RepoScanner.open(dir)
    const anchor = await head(scanner)
    const diff = await diffSince(scanner, anchor)
    expect(diff).toEqual({ modified: [], deleted: [], added: [] })
  })

  it('重命名拆为删除旧路径 + 新增新路径', async () => {
    const dir = await makeFixtureRepo()
    const scanner = await RepoScanner.open(dir)
    const anchor = await head(scanner)
    // 内容相同的文件移动 → git 检测为 rename(--find-renames)
    await commitChange(dir, { 'src/auth.js': null, 'src/login.js': AUTH_JS }, 'rename auth')
    const diff = await diffSince(scanner, anchor)
    // 不论 git 把它判为 R 还是 A+D,旧路径应在 deleted,新路径应在 added
    expect(diff.deleted).toContain('src/auth.js')
    expect(diff.added).toContain('src/login.js')
  })
})

describe('analyzeImpact', () => {
  const empty: RepoDiff = { modified: [], deleted: [], added: [] }

  it('引用文件被修改 → stale', () => {
    const lf = new Map<string, string[]>([['l1', ['src/auth.js']]])
    const diff: RepoDiff = { ...empty, modified: ['src/auth.js'] }
    const r = analyzeImpact(lf, diff)
    expect(r.staleLevels).toContain('l1')
    expect(r.obsoleteLevels).toEqual([])
  })

  it('引用文件全部被删 → obsolete', () => {
    const lf = new Map<string, string[]>([['l1', ['src/gone.js']]])
    const diff: RepoDiff = { ...empty, deleted: ['src/gone.js'] }
    const r = analyzeImpact(lf, diff)
    expect(r.obsoleteLevels).toContain('l1')
    expect(r.staleLevels).toEqual([])
  })

  it('部分文件被删 → stale', () => {
    const lf = new Map<string, string[]>([['l1', ['src/a.js', 'src/gone.js']]])
    const diff: RepoDiff = { ...empty, deleted: ['src/gone.js'] }
    const r = analyzeImpact(lf, diff)
    expect(r.staleLevels).toContain('l1')
    expect(r.obsoleteLevels).toEqual([])
  })

  it('未受影响关卡不进任一列表', () => {
    const lf = new Map<string, string[]>([['l1', ['src/untouched.js']]])
    const diff: RepoDiff = { ...empty, modified: ['src/other.js'] }
    const r = analyzeImpact(lf, diff)
    expect(r.staleLevels).toEqual([])
    expect(r.obsoleteLevels).toEqual([])
  })

  it('新增文件达到阈值 → needsNewLevels', () => {
    expect(NEW_FILES_THRESHOLD).toBe(3)
    const lf = new Map<string, string[]>()
    const three = analyzeImpact(lf, { ...empty, added: ['a', 'b', 'c'] })
    expect(three.needsNewLevels).toBe(true)
    const two = analyzeImpact(lf, { ...empty, added: ['a', 'b'] })
    expect(two.needsNewLevels).toBe(false)
  })
})

// ─── CourseUpdater(增量更新管线)────────────────────────────────────────────

const courseDraft = {
  projectName: 'demo',
  tagline: '一段奇妙的源码之旅',
  chapters: [
    {
      id: 'ch1',
      title: '初入江湖',
      intro: '了解项目全貌',
      levels: [
        { id: 'lv-a', title: '登录大门', goal: '读懂 login 函数', files: ['src/auth.js'] },
        { id: 'lv-b', title: '项目说明', goal: '读懂 README', files: ['README.md'] },
      ],
    },
  ],
}

/** lv-a 的出题:引用 src/auth.js 的前几行 */
const levelDraftA = {
  title: '登录大门',
  summary: '走进 login 的世界',
  tasks: [
    {
      id: 'a1', type: 'quiz', narrative: '勇者你好!', question: 'login 失败时会怎样?',
      options: ['抛出异常', '返回 null'], answer: [0], explanation: '没有 user 会 throw',
      refs: [{ file: 'src/auth.js', startLine: 1, endLine: 4, contentHash: '' }],
    },
    {
      id: 'a2', type: 'treasure-hunt', narrative: '寻宝!', instruction: '找到 token', hint: '下半部分',
      explanation: 'token 签发', target: { file: 'src/auth.js', startLine: 6, endLine: 8, contentHash: '' },
    },
  ],
}

/** lv-b 的出题:引用 README.md */
const levelDraftB = {
  title: '项目说明',
  summary: '读懂 README',
  tasks: [
    {
      id: 'b1', type: 'quiz', narrative: '看板娘说', question: '这是什么项目?',
      options: ['演示项目', '生产系统'], answer: [0], explanation: '一个演示项目',
      refs: [{ file: 'README.md', startLine: 1, endLine: 2, contentHash: '' }],
    },
    {
      id: 'b2', type: 'code-type', narrative: '临摹', explanation: '抄一遍标题',
      ref: { file: 'README.md', startLine: 1, endLine: 2, contentHash: '' },
    },
  ],
}

/** 初始生成所用 mock:按 outline 标题分发出题草稿(用「关卡: 标题」精确匹配,避免被课程大纲文本干扰) */
function genMock() {
  return new MockProvider((opts: GenerateOptions<unknown>) => {
    if (opts.schemaName === 'course') return courseDraft
    return opts.prompt.includes('关卡: 项目说明') ? levelDraftB : levelDraftA
  })
}

describe('CourseUpdater', () => {
  let repo: string
  let store: ProjectStore

  beforeEach(async () => {
    await makeDataHome()
    repo = await makeFixtureRepo()
    const scanner = await RepoScanner.open(repo)
    store = new ProjectStore(projectIdFor(repo))
    await store.writeMeta({
      id: store.id, path: repo, name: 'demo', isGit: true,
      anchorCommit: await scanner.head(), createdAt: new Date().toISOString(),
      generation: { status: 'idle' },
    })
    // 完整生成初始课程与关卡
    await new LevelGenerator(store, scanner, genMock()).run()
    // 写入一份进度(lv-a 已通关),用于验证 progress 永不被触碰
    const progress: Progress = {
      xp: 100,
      completedLevels: { 'lv-a': { rating: 'S', accuracy: 1, maxCombo: 5, xp: 100 } },
      badges: ['first-blood'],
      filesRead: ['src/auth.js'],
    }
    await store.writeProgress(progress)
  })

  async function freshScanner() {
    return RepoScanner.open(repo)
  }

  function rawPath(file: string) {
    return path.join(store.dir, file)
  }
  async function rawRead(file: string) {
    return fs.readFile(rawPath(file), 'utf8')
  }

  it('check:无变更时 changed=false', async () => {
    const scanner = await freshScanner()
    const updater = new CourseUpdater(store, scanner, genMock())
    const r = await updater.check()
    expect(r.changed).toBe(false)
  })

  it('Case 1 修改:lv-a 被修订,lv-b 不动,anchor 前进,progress 原样', async () => {
    await commitChange(repo, { 'src/auth.js': 'function login() { return 42 }\n' }, 'modify auth')

    const scanner = await freshScanner()
    const newHead = (await scanner.head())!

    // check 检出修改
    const checked = await new CourseUpdater(store, scanner, genMock()).check()
    expect(checked.changed).toBe(true)
    expect(checked.summary?.modified).toBe(1)

    const lvBBefore = await rawRead(path.join('levels', 'lv-b.json'))
    const progressBefore = await rawRead('progress.json')
    const lvAHashBefore = JSON.parse(await rawRead(path.join('levels', 'lv-a.json')))
      .tasks[0].refs[0].contentHash

    // 修订 mock:针对新 auth.js(1 行)出一道引用第 1 行的题
    const reviseMock = new MockProvider((opts: GenerateOptions<unknown>) => {
      if (opts.schemaName === 'level') {
        return {
          title: '登录大门(已更新)',
          summary: '新版 login',
          tasks: [
            {
              id: 'a1', type: 'quiz', narrative: '代码变了!', question: 'login 现在返回什么?',
              options: ['42', 'token'], answer: [0], explanation: '直接返回 42',
              refs: [{ file: 'src/auth.js', startLine: 1, endLine: 1, contentHash: '' }],
            },
            {
              id: 'a2', type: 'code-type', narrative: '临摹新代码', explanation: '抄一遍新 login',
              ref: { file: 'src/auth.js', startLine: 1, endLine: 1, contentHash: '' },
            },
          ],
        }
      }
      throw new Error('unexpected schema ' + opts.schemaName)
    })

    const updater = new CourseUpdater(store, await freshScanner(), reviseMock)
    const events: string[] = []
    updater.on('event', (e: { type: string }) => events.push(e.type))
    await updater.run()

    // lv-a 被修订:contentHash 变化(指向新代码)
    const lvAAfter = JSON.parse(await rawRead(path.join('levels', 'lv-a.json')))
    expect(lvAAfter.title).toBe('登录大门(已更新)')
    expect(lvAAfter.tasks[0].refs[0].contentHash).not.toBe(lvAHashBefore)
    expect(lvAAfter.status).toBe('ready')

    // lv-b 完全没动
    expect(await rawRead(path.join('levels', 'lv-b.json'))).toBe(lvBBefore)

    // course outline:lv-a ready
    const course = (await store.readCourse())!
    const outlineA = course.chapters[0].levels.find((l) => l.id === 'lv-a')!
    expect(outlineA.status).toBe('ready')

    // anchor 前进
    expect((await store.readMeta())!.anchorCommit).toBe(newHead)

    // progress 原样
    expect(await rawRead('progress.json')).toBe(progressBefore)

    expect(events).toContain('update-start')
    expect(events).toContain('level')
    expect(events).toContain('done')

    // 再次 check:无变更
    const recheck = await new CourseUpdater(store, await freshScanner(), genMock()).check()
    expect(recheck.changed).toBe(false)
  })

  it('Case 2 删除:lv-b obsolete,progress 保留', async () => {
    await commitChange(repo, { 'README.md': null }, 'delete readme')
    const progressBefore = await rawRead('progress.json')

    const updater = new CourseUpdater(store, await freshScanner(), genMock())
    await updater.run()

    const lvB = (await store.readLevel('lv-b'))!
    expect(lvB.status).toBe('obsolete')
    const course = (await store.readCourse())!
    expect(course.chapters[0].levels.find((l) => l.id === 'lv-b')!.status).toBe('obsolete')

    // progress 原样
    expect(await rawRead('progress.json')).toBe(progressBefore)
  })

  it('Case 3 新增 3 文件:追加新关卡,已有 outline 不变', async () => {
    await commitChange(
      repo,
      { 'src/x.js': 'export const x = 1\n', 'src/y.js': 'export const y = 2\n', 'src/z.js': 'export const z = 3\n' },
      'add three',
    )

    const appendMock = new MockProvider((opts: GenerateOptions<unknown>) => {
      if (opts.schemaName === 'append') {
        return {
          chapters: [
            {
              id: 'ch-new', title: '新大陆', intro: '探索新增模块',
              levels: [{ id: 'lv-x', title: 'X 模块', goal: '读懂 x', files: ['src/x.js'] }],
            },
          ],
        }
      }
      if (opts.schemaName === 'level') {
        return {
          title: 'X 模块', summary: '读懂 x',
          tasks: [
            {
              id: 'x1', type: 'quiz', narrative: '新模块!', question: 'x 是多少?',
              options: ['1', '2'], answer: [0], explanation: 'x = 1',
              refs: [{ file: 'src/x.js', startLine: 1, endLine: 1, contentHash: '' }],
            },
            {
              id: 'x2', type: 'code-type', narrative: '临摹', explanation: '抄一遍 x',
              ref: { file: 'src/x.js', startLine: 1, endLine: 1, contentHash: '' },
            },
          ],
        }
      }
      throw new Error('unexpected schema ' + opts.schemaName)
    })

    const updater = new CourseUpdater(store, await freshScanner(), appendMock)
    const events: string[] = []
    updater.on('event', (e: { type: string }) => events.push(e.type))
    await updater.run()

    const course = (await store.readCourse())!
    // 已有 outline 不变
    expect(course.chapters[0].id).toBe('ch1')
    expect(course.chapters[0].levels.map((l) => l.id)).toEqual(['lv-a', 'lv-b'])
    expect(course.chapters[0].levels.every((l) => l.status === 'ready')).toBe(true)
    // 新章节追加
    const newCh = course.chapters.find((c) => c.id === 'ch-new')!
    expect(newCh).toBeDefined()
    const newOutline = newCh.levels.find((l) => l.id === 'lv-x')!
    expect(newOutline.status).toBe('ready')

    const newLevel = (await store.readLevel('lv-x'))!
    expect(newLevel.status).toBe('ready')
    expect(events).toContain('level')
    expect(events).toContain('done')
  })

  it('Case 4 修订失败:outline stale,旧 level 不变,done,anchor 前进', async () => {
    await commitChange(repo, { 'src/auth.js': 'function login() { return 42 }\n' }, 'modify auth')
    const scanner = await freshScanner()
    const newHead = (await scanner.head())!

    const lvABefore = await rawRead(path.join('levels', 'lv-a.json'))

    const failMock = new MockProvider((opts: GenerateOptions<unknown>) => {
      if (opts.schemaName === 'level') throw new Error('revision boom')
      throw new Error('unexpected schema ' + opts.schemaName)
    })

    const updater = new CourseUpdater(store, await freshScanner(), failMock)
    const events: string[] = []
    updater.on('event', (e: { type: string }) => events.push(e.type))
    await updater.run()

    const course = (await store.readCourse())!
    expect(course.chapters[0].levels.find((l) => l.id === 'lv-a')!.status).toBe('stale')

    // 旧 level JSON 原样保留(可玩)
    expect(await rawRead(path.join('levels', 'lv-a.json'))).toBe(lvABefore)

    // anchor 仍前进
    expect((await store.readMeta())!.anchorCommit).toBe(newHead)

    expect(events).toContain('level-failed')
    expect(events).toContain('done')
  })
})
