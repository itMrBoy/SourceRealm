import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execa } from 'execa'

export const AUTH_JS = `function login(user, pass) {
  if (!user) throw new Error('no user')
  return token(user)
}

function token(user) {
  return 'tk-' + user
}

module.exports = { login }
`

/** 创建一个带 1 个 commit 的临时 git 仓库,返回路径 */
export async function makeFixtureRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cq-fixture-'))
  await fs.writeFile(path.join(dir, 'README.md'), '# demo\n一个演示项目\n')
  await fs.mkdir(path.join(dir, 'src'))
  await fs.writeFile(path.join(dir, 'src/auth.js'), AUTH_JS)
  const git = (...args: string[]) =>
    execa('git', ['-c', 'user.email=t@t.dev', '-c', 'user.name=tester', ...args], { cwd: dir })
  await git('init')
  await git('add', '.')
  await git('commit', '-m', 'init')
  return dir
}

/** 在 fixture 仓库提交一组变更:value 为 null 表示删除文件 */
export async function commitChange(
  dir: string,
  files: Record<string, string | null>,
  msg: string,
): Promise<void> {
  for (const [rel, value] of Object.entries(files)) {
    const abs = path.join(dir, rel)
    if (value === null) {
      await fs.rm(abs, { force: true })
    } else {
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, value)
    }
  }
  const git = (...args: string[]) =>
    execa('git', ['-c', 'user.email=t@t.dev', '-c', 'user.name=tester', ...args], { cwd: dir })
  await git('add', '-A')
  await git('commit', '-m', msg)
}

/** 临时数据目录(隔离默认 .sourcerealm) */
export async function makeDataHome(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cq-home-'))
  process.env.SOURCEREALM_HOME = dir
  return dir
}
