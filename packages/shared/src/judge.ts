import type { CodeRef } from './schema.js'

/** quiz:选项集合相等(顺序无关) */
export function judgeQuiz(answer: number[], selected: number[]): boolean {
  if (answer.length !== selected.length) return false
  const want = new Set(answer)
  return selected.every((i) => want.has(i)) && new Set(selected).size === answer.length
}

/** treasure-hunt:点击位置落在目标文件的行范围内 */
export function judgeTreasureHunt(target: CodeRef, pick: { file: string; line: number }): boolean {
  return pick.file === target.file && pick.line >= target.startLine && pick.line <= target.endLine
}

/** call-chain:顺序完全一致 */
export function judgeCallChain(order: number[], submitted: number[]): boolean {
  return order.length === submitted.length && order.every((v, i) => v === submitted[i])
}

/** 压缩行内空白、去首尾空白、去空行 —— code-fill 比对用 */
export function normalizeCode(s: string): string {
  return s
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/** code-fill:逐空比对(忽略空白差异) */
export function judgeCodeFill(answers: string[], submitted: string[]): boolean {
  if (answers.length !== submitted.length) return false
  return answers.every((a, i) => normalizeCode(a) === normalizeCode(submitted[i] ?? ''))
}

/**
 * code-type:逐字符比对统计 correct/accuracy(实时显示用)。
 * complete 忽略空白差异:行首尾空白不计、行内空白只匹配有无(不计长度)、忽略结尾空行。
 */
export function judgeCodeType(expected: string, typed: string): { correct: number; accuracy: number; complete: boolean } {
  let correct = 0
  for (let i = 0; i < typed.length && i < expected.length; i++) {
    if (typed[i] === expected[i]) correct++
  }
  return {
    correct,
    accuracy: typed.length === 0 ? 1 : correct / typed.length,
    complete: typed.length > 0 && normalizeCode(typed) === normalizeCode(expected),
  }
}
