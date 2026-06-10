import { execa } from 'execa'
import type { RepoScanner } from './scanner.js'

export interface RepoDiff {
  modified: string[]
  deleted: string[]
  added: string[]
}

/**
 * 计算 anchor..HEAD 的文件级变更集。
 * 解析 git diff --name-status:
 *   M / T → modified
 *   A / C → added(C 取新路径)
 *   D     → deleted
 *   R     → 旧路径 deleted + 新路径 added
 */
export async function diffSince(scanner: RepoScanner, anchor: string): Promise<RepoDiff> {
  const { stdout } = await execa(
    'git',
    ['diff', '--name-status', '--find-renames', `${anchor}..HEAD`],
    { cwd: scanner.root },
  )
  const diff: RepoDiff = { modified: [], deleted: [], added: [] }
  if (!stdout) return diff

  for (const line of stdout.split('\n')) {
    if (!line) continue
    const parts = line.split('\t')
    const status = parts[0]
    const code = status[0]
    switch (code) {
      case 'M':
      case 'T':
        if (parts[1]) diff.modified.push(parts[1])
        break
      case 'A':
        if (parts[1]) diff.added.push(parts[1])
        break
      case 'D':
        if (parts[1]) diff.deleted.push(parts[1])
        break
      case 'C':
        // copy:新路径是最后一段
        if (parts[2]) diff.added.push(parts[2])
        else if (parts[1]) diff.added.push(parts[1])
        break
      case 'R':
        // rename:R<score>\t<old>\t<new>
        if (parts[1]) diff.deleted.push(parts[1])
        if (parts[2]) diff.added.push(parts[2])
        break
      default:
        break
    }
  }
  return diff
}

export interface ImpactResult {
  staleLevels: string[]
  obsoleteLevels: string[]
  needsNewLevels: boolean
}

export const NEW_FILES_THRESHOLD = 3

/**
 * 纯函数:基于关卡引用文件与 diff 计算影响。
 * - 引用文件全部被删 → obsolete
 * - 否则任一引用文件被删或被改 → stale
 * - 新增文件数 ≥ 阈值 → needsNewLevels
 */
export function analyzeImpact(levelFiles: Map<string, string[]>, diff: RepoDiff): ImpactResult {
  const deleted = new Set(diff.deleted)
  const modified = new Set(diff.modified)
  const staleLevels: string[] = []
  const obsoleteLevels: string[] = []

  for (const [levelId, refs] of levelFiles) {
    if (refs.length > 0 && refs.every((r) => deleted.has(r))) {
      obsoleteLevels.push(levelId)
    } else if (refs.some((r) => deleted.has(r) || modified.has(r))) {
      staleLevels.push(levelId)
    }
  }

  return {
    staleLevels,
    obsoleteLevels,
    needsNewLevels: diff.added.length >= NEW_FILES_THRESHOLD,
  }
}
