import { describe, expect, it } from 'vitest'
import { RepoScanner, hashLines } from '../src/scanner.js'
import { makeFixtureRepo, AUTH_JS } from './helpers.js'

describe('RepoScanner', () => {
  it('拒绝不存在的路径', async () => {
    await expect(RepoScanner.open('/no/such/dir-xyz')).rejects.toThrow('不是有效目录')
  })

  it('识别 git 仓库并读取 HEAD', async () => {
    const dir = await makeFixtureRepo()
    const scanner = await RepoScanner.open(dir)
    expect(scanner.isGit).toBe(true)
    expect(await scanner.head()).toMatch(/^[0-9a-f]{40}$/)
  })

  it('列出文件树(git ls-files)', async () => {
    const scanner = await RepoScanner.open(await makeFixtureRepo())
    const tree = await scanner.fileTree()
    expect(tree).toContain('README.md')
    expect(tree).toContain('src/auth.js')
  })

  it('读取文件并阻止路径穿越', async () => {
    const scanner = await RepoScanner.open(await makeFixtureRepo())
    expect(await scanner.readFile('src/auth.js')).toBe(AUTH_JS)
    await expect(scanner.readFile('../etc/passwd')).rejects.toThrow('非法路径')
  })

  it('readRef 返回片段文本并校验 hash', async () => {
    const scanner = await RepoScanner.open(await makeFixtureRepo())
    const lines = AUTH_JS.split('\n').slice(0, 4).join('\n')
    const ref = { file: 'src/auth.js', startLine: 1, endLine: 4, contentHash: hashLines(lines) }
    const got = await scanner.readRef(ref)
    expect(got.fresh).toBe(true)
    expect(got.text).toContain('function login')
    const stale = await scanner.readRef({ ...ref, contentHash: 'deadbeef' })
    expect(stale.fresh).toBe(false)
    const oob = await scanner.readRef({ ...ref, startLine: 999, endLine: 1000 })
    expect(oob.fresh).toBe(false)
  })
})
