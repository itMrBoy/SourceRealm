import { describe, expect, it } from 'vitest'
import { judgeQuiz, judgeTreasureHunt, judgeCallChain, judgeCodeFill, judgeCodeType, normalizeCode } from '../src/index.js'

describe('judgeQuiz', () => {
  it('选项集合相等即正确(顺序无关)', () => {
    expect(judgeQuiz([0, 2], [2, 0])).toBe(true)
    expect(judgeQuiz([0, 2], [0])).toBe(false)
    expect(judgeQuiz([1], [1])).toBe(true)
  })
})

describe('judgeTreasureHunt', () => {
  // md 目标 28-36:28 标题、29 空行、30-36 七条内容
  const mdTarget = { file: 'README.md', startLine: 28, endLine: 36, contentHash: '' }
  const mdText = ['## 公开接口', '', '- a', '- b', '- c', '- d', '- e', '- f', '- g']

  it('选全内容行即对:忽略空行、md 标题可选(连标题/空行一起选也对)', () => {
    expect(judgeTreasureHunt(mdTarget, { file: 'README.md', lines: [30, 31, 32, 33, 34, 35, 36] }, mdText)).toEqual({
      correct: true,
      overlap: true,
    })
    expect(
      judgeTreasureHunt(mdTarget, { file: 'README.md', lines: [28, 29, 30, 31, 32, 33, 34, 35, 36] }, mdText).correct,
    ).toBe(true)
  })
  it('少选内容行算错,但与目标有交集 overlap=true', () => {
    const v = judgeTreasureHunt(mdTarget, { file: 'README.md', lines: [30, 31, 32] }, mdText)
    expect(v.correct).toBe(false)
    expect(v.overlap).toBe(true)
  })
  it('越界算错', () => {
    expect(
      judgeTreasureHunt(mdTarget, { file: 'README.md', lines: [30, 31, 32, 33, 34, 35, 36, 37] }, mdText).correct,
    ).toBe(false)
  })
  it('完全不相干/错文件 overlap=false', () => {
    expect(judgeTreasureHunt(mdTarget, { file: 'README.md', lines: [50, 51] }, mdText).overlap).toBe(false)
    expect(judgeTreasureHunt(mdTarget, { file: 'other.md', lines: [30] }, mdText).overlap).toBe(false)
  })
  it('非 md 文件 # 注释不豁免,空行可不选', () => {
    const py = { file: 'a.py', startLine: 1, endLine: 3, contentHash: '' }
    const pyText = ['# comment', 'x = 1', '']
    expect(judgeTreasureHunt(py, { file: 'a.py', lines: [1, 2] }, pyText).correct).toBe(true)
    expect(judgeTreasureHunt(py, { file: 'a.py', lines: [2] }, pyText).correct).toBe(false)
  })
  it('targetText 为空时退化为严格全区间', () => {
    expect(
      judgeTreasureHunt(mdTarget, { file: 'README.md', lines: [28, 29, 30, 31, 32, 33, 34, 35, 36] }, []).correct,
    ).toBe(true)
    expect(judgeTreasureHunt(mdTarget, { file: 'README.md', lines: [30, 31, 32, 33, 34, 35, 36] }, []).correct).toBe(
      false,
    )
  })
})

describe('judgeCallChain', () => {
  it('序列完全一致即正确', () => {
    expect(judgeCallChain([2, 0, 1], [2, 0, 1])).toBe(true)
    expect(judgeCallChain([2, 0, 1], [0, 2, 1])).toBe(false)
  })
})

describe('judgeCodeFill', () => {
  it('逐空比对,忽略空白差异', () => {
    expect(judgeCodeFill(['return token(user)'], ['  return   token(user) '])).toBe(true)
    expect(judgeCodeFill(['return token(user)'], ['return token(x)'])).toBe(false)
    expect(judgeCodeFill(['a', 'b'], ['a'])).toBe(false)
  })
})

describe('judgeCodeType', () => {
  it('逐字符比对并统计准确率', () => {
    expect(judgeCodeType('abc', 'abc')).toEqual({ correct: 3, accuracy: 1, complete: true })
    const r = judgeCodeType('abc', 'axc')
    expect(r.correct).toBe(2)
    expect(r.accuracy).toBeCloseTo(2 / 3)
    expect(r.complete).toBe(false)
    expect(judgeCodeType('abc', '')).toEqual({ correct: 0, accuracy: 1, complete: false })
  })

  it('complete 忽略空白差异', () => {
    // 结尾多一个换行/空行仍判完成(本次 bug 主因)
    expect(judgeCodeType('a\nb', 'a\nb\n').complete).toBe(true)
    expect(judgeCodeType('a\nb', 'a\nb\n\n').complete).toBe(true)
    // 行首缩进/行内空白长度不同仍判完成
    expect(judgeCodeType('  foo(a, b)', 'foo(a,  b)').complete).toBe(true)
    // 单词被连在一起(缺分隔)判未完成
    expect(judgeCodeType('a b', 'ab').complete).toBe(false)
    // 可见内容不一致仍判未完成
    expect(judgeCodeType('foo', 'bar').complete).toBe(false)
    // 空输入不判完成
    expect(judgeCodeType('abc', '').complete).toBe(false)
  })
})

describe('normalizeCode', () => {
  it('压缩空白、去空行', () => {
    expect(normalizeCode('  a =  1 \n\n  b=2  ')).toBe('a = 1\nb=2')
  })
})
