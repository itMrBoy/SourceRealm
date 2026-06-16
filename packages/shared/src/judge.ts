import type { CodeRef } from './schema.js'

/** quiz:选项集合相等(顺序无关) */
export function judgeQuiz(answer: number[], selected: number[]): boolean {
  if (answer.length !== selected.length) return false
  const want = new Set(answer)
  return selected.every((i) => want.has(i)) && new Set(selected).size === answer.length
}

/**
 * treasure-hunt 智能容差判定:
 * - 忽略空行;markdown(.md) 文件里 `#` 标题行视为可选
 * - 核心内容行必须全选,且不得越界
 * - targetText 为目标区间 startLine..endLine 的逐行文本(可空,空则退化为严格全区间)
 * 返回 correct(是否答对) 与 overlap(选区是否与目标有交集,用于决定是否扣心)
 */
export function judgeTreasureHunt(
  target: CodeRef,
  selected: { file: string; lines: number[] },
  targetText: string[],
): { correct: boolean; overlap: boolean } {
  const inRange = (line: number): boolean => line >= target.startLine && line <= target.endLine
  const sameFile = selected.file === target.file
  if (!sameFile) return { correct: false, overlap: false }
  const overlap = selected.lines.some(inRange)

  const md = target.file.toLowerCase().endsWith('.md')
  const isBlank = (text: string): boolean => text.trim() === ''
  const isHeading = (text: string): boolean => md && /^\s*#{1,6}\s/.test(text)

  // 核心内容行:区间内既非空行也非(md)标题行;边界标题/空行可选
  const nonBlank: number[] = []
  let required: number[] = []
  if (targetText.length > 0) {
    for (let i = 0; i < targetText.length; i++) {
      const line = target.startLine + i
      const text = targetText[i] ?? ''
      if (isBlank(text)) continue
      nonBlank.push(line)
      if (!isHeading(text)) required.push(line)
    }
    // 整段全是标题/空行时回退为非空行,避免空 required 致任意选都对
    if (required.length === 0) required = nonBlank
  } else {
    // 内容未取到:安全退化为严格全区间
    for (let line = target.startLine; line <= target.endLine; line++) required.push(line)
  }

  const picked = new Set(selected.lines)
  const allInRange = selected.lines.every(inRange)
  const coversRequired = required.every((line) => picked.has(line))
  const correct = picked.size > 0 && allInRange && coversRequired
  return { correct, overlap }
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
