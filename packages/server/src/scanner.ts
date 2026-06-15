import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execa } from 'execa'
import type { CodeRef } from '@sourcerealm/shared'

const MAX_FILES = 5000
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'vendor'])

/** 对片段文本(去尾随空白)取 sha256 前 16 位 */
export function hashLines(text: string): string {
  const norm = text.split('\n').map((l) => l.trimEnd()).join('\n')
  return createHash('sha256').update(norm).digest('hex').slice(0, 16)
}

export class RepoScanner {
  private constructor(
    readonly root: string,
    readonly isGit: boolean,
  ) {}

  static async open(p: string): Promise<RepoScanner> {
    const root = path.resolve(p)
    const stat = await fs.stat(root).catch(() => null)
    if (!stat?.isDirectory()) throw new Error(`不是有效目录: ${root}`)
    const isGit = await execa('git', ['rev-parse', '--git-dir'], { cwd: root }).then(
      () => true,
      () => false,
    )
    return new RepoScanner(root, isGit)
  }

  /** 当前 HEAD commit;非 git 或空仓库返回 null */
  async head(): Promise<string | null> {
    if (!this.isGit) return null
    try {
      const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd: this.root })
      return stdout || null
    } catch {
      return null
    }
  }

  async fileTree(): Promise<string[]> {
    if (this.isGit) {
      const { stdout } = await execa('git', ['ls-files'], { cwd: this.root })
      return stdout ? stdout.split('\n').slice(0, MAX_FILES) : []
    }
    const out: string[] = []
    const walk = async (dir: string): Promise<void> => {
      if (out.length >= MAX_FILES) return
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (out.length >= MAX_FILES) return
        const abs = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) await walk(abs)
        } else {
          out.push(path.relative(this.root, abs))
        }
      }
    }
    await walk(this.root)
    return out
  }

  private resolveInside(rel: string): string {
    const abs = path.resolve(this.root, rel)
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) throw new Error(`非法路径: ${rel}`)
    return abs
  }

  async readFile(rel: string): Promise<string> {
    return fs.readFile(this.resolveInside(rel), 'utf8')
  }

  /** 读取引用片段;文件缺失/越界/被改都体现在 fresh=false */
  async readRef(ref: CodeRef): Promise<{ text: string; actualHash: string; fresh: boolean }> {
    let content: string
    try {
      content = await this.readFile(ref.file)
    } catch {
      return { text: '', actualHash: '', fresh: false }
    }
    const lines = content.split('\n')
    if (ref.startLine > lines.length || ref.endLine > lines.length) {
      return { text: '', actualHash: '', fresh: false }
    }
    const text = lines.slice(ref.startLine - 1, ref.endLine).join('\n')
    const actualHash = hashLines(text)
    return { text, actualHash, fresh: actualHash === ref.contentHash }
  }
}
