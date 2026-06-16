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
  const target = { file: 'src/auth.js', startLine: 2, endLine: 4, contentHash: '' }
  it('同文件且行号落在范围内即命中', () => {
    expect(judgeTreasureHunt(target, { file: 'src/auth.js', line: 3 })).toBe(true)
    expect(judgeTreasureHunt(target, { file: 'src/auth.js', line: 5 })).toBe(false)
    expect(judgeTreasureHunt(target, { file: 'src/other.js', line: 3 })).toBe(false)
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
