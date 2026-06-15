import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 查询 npm 全局安装根目录(`npm prefix -g`);失败返回 null。结果会被缓存。 */
let npmPrefixCache: string | null | undefined
function npmGlobalPrefix(): string | null {
  if (npmPrefixCache !== undefined) return npmPrefixCache
  try {
    npmPrefixCache =
      execSync('npm prefix -g', { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() ||
      null
  } catch {
    npmPrefixCache = null
  }
  return npmPrefixCache
}

/** 在一个目录下找到名字以 prefix 开头的第一个子目录,返回其中 suffix 文件(用于 winget 包目录名带 hash 的情况) */
function firstGlobMatch(dir: string, prefix: string, suffix: string): string | null {
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(prefix)) {
        const inner = path.join(dir, name, suffix)
        if (fs.existsSync(inner)) return inner
      }
    }
  } catch {
    /* 目录不存在 */
  }
  return null
}

/**
 * 按优先级生成 claude 可执行文件的候选路径(纯函数,不做存在性检查,便于单测)。
 * 覆盖:显式覆盖 → winget(Windows)→ npm 全局 → 各平台常见安装位置 → PATH 兜底。
 */
export function claudeBinCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = []
  const explicit = env.SOURCEREALM_CLAUDE_PATH?.trim()
  if (explicit) out.push(explicit)

  const home = os.homedir()
  const prefix = npmGlobalPrefix()

  if (process.platform === 'win32') {
    const local = env.LOCALAPPDATA
    const appdata = env.APPDATA
    // winget:Links(若存在更稳)与 Packages(目录名带 hash,需通配)
    if (local) {
      out.push(path.join(local, 'Microsoft', 'WinGet', 'Links', 'claude.exe'))
      const pkgMatch = firstGlobMatch(
        path.join(local, 'Microsoft', 'WinGet', 'Packages'),
        'Anthropic.ClaudeCode',
        'claude.exe',
      )
      if (pkgMatch) out.push(pkgMatch)
    }
    // npm 全局:Windows 下 bin 直接在 prefix 根目录(claude.cmd / claude.exe)
    if (prefix) {
      out.push(path.join(prefix, 'claude.cmd'), path.join(prefix, 'claude.exe'))
    }
    if (appdata) {
      out.push(path.join(appdata, 'npm', 'claude.cmd'), path.join(appdata, 'npm', 'claude.exe'))
    }
    out.push(path.join(home, '.local', 'bin', 'claude.exe'))
  } else {
    // npm 全局:Unix 下在 prefix/bin
    if (prefix) out.push(path.join(prefix, 'bin', 'claude'))
    out.push(
      '/opt/homebrew/bin/claude', // macOS Apple Silicon Homebrew
      '/usr/local/bin/claude', // macOS Intel Homebrew / 通用
      '/usr/bin/claude',
      path.join(home, '.local', 'bin', 'claude'), // 官方 installer
      path.join(home, '.npm-global', 'bin', 'claude'),
      path.join(home, '.claude', 'local', 'claude'),
    )
  }
  // 最后兜底:依赖进程 PATH
  out.push('claude')
  return out
}

/**
 * 解析 claude 可执行文件路径:返回第一个**实际存在**的候选;若都不存在,回落到 'claude'(走 PATH)。
 * 结果缓存(避免每次都做文件系统探测)。
 */
let claudeBinCache: string | undefined
export function resolveClaudeBin(env: NodeJS.ProcessEnv = process.env): string {
  if (claudeBinCache !== undefined) return claudeBinCache
  for (const c of claudeBinCandidates(env)) {
    // 'claude'(裸名)无法用 existsSync 判断,留作最终兜底
    if (c === 'claude') continue
    if (fs.existsSync(c)) {
      claudeBinCache = c
      return c
    }
  }
  claudeBinCache = 'claude'
  return claudeBinCache
}

/** 测试用:清空探测缓存 */
export function resetClaudeBinCache(): void {
  claudeBinCache = undefined
  npmPrefixCache = undefined
}
