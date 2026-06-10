import { describe, expect, it } from 'vitest'
import { RepoScanner } from '../src/scanner.js'
import {
  diffSince,
  analyzeImpact,
  NEW_FILES_THRESHOLD,
  type RepoDiff,
} from '../src/updater.js'
import { makeFixtureRepo, commitChange, AUTH_JS } from './helpers.js'

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
