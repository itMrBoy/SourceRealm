import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { MockProvider, extractJson, generateWithRetry } from '../src/providers.js'

const schema = z.object({ name: z.string() })

describe('MockProvider', () => {
  it('返回值经 schema 校验', async () => {
    const ok = new MockProvider(() => ({ name: 'x' }))
    expect(await ok.generate({ prompt: 'p', schema, schemaName: 's' })).toEqual({ name: 'x' })
    const bad = new MockProvider(() => ({ wrong: 1 }))
    await expect(bad.generate({ prompt: 'p', schema, schemaName: 's' })).rejects.toThrow()
  })
})

describe('extractJson', () => {
  it('直接解析纯 JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
  })
  it('剥掉代码块围栏与前后缀文本', () => {
    expect(extractJson('好的!\n```json\n{"a":1}\n```\n完毕')).toEqual({ a: 1 })
    expect(extractJson('前缀 {"a":{"b":2}} 后缀')).toEqual({ a: { b: 2 } })
  })
  it('无 JSON 时抛错', () => {
    expect(() => extractJson('没有内容')).toThrow()
  })
})

describe('generateWithRetry', () => {
  it('失败后带错误重试,第二次成功', async () => {
    let calls = 0
    const prompts: string[] = []
    const flaky = new MockProvider((opts) => {
      prompts.push(opts.prompt)
      calls++
      return calls === 1 ? { wrong: 1 } : { name: 'ok' }
    })
    const result = await generateWithRetry(flaky, { prompt: 'base', schema, schemaName: 's' })
    expect(result).toEqual({ name: 'ok' })
    expect(calls).toBe(2)
    expect(prompts[1]).toContain('上一次输出不符合要求')
  })
  it('重试 2 次后仍失败则抛出', async () => {
    let calls = 0
    const broken = new MockProvider(() => { calls++; return { wrong: 1 } })
    await expect(generateWithRetry(broken, { prompt: 'p', schema, schemaName: 's' })).rejects.toThrow()
    expect(calls).toBe(3)
  })
})
