import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  AnthropicApiProvider,
  ClaudeCliProvider,
  MockProvider,
  ProviderError,
  buildClaudeCliPrompt,
  buildCliEnv,
  claudeBinCandidates,
  detectProviderMode,
  extractJson,
  generateWithRetry,
  resetClaudeBinCache,
  resolveClaudeBin,
  selectProvider,
} from '../src/providers.js'

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

describe('buildClaudeCliPrompt', () => {
  it('把 schema 附加到 stdin prompt,避免作为命令行参数传递超长内容', () => {
    const prompt = buildClaudeCliPrompt({ prompt: 'base', schema, schemaName: 'sample' })
    expect(prompt).toContain('base')
    expect(prompt).toContain('JSON Schema')
    expect(prompt).toContain('sample')
  })
  it('CLI 模式追加 explorationHint(引导自主 Read),不内嵌源码', () => {
    const prompt = buildClaudeCliPrompt({
      prompt: 'base',
      schema,
      schemaName: 'sample',
      explorationHint: '请用 Read 打开相关文件',
    })
    expect(prompt).toContain('请用 Read 打开相关文件')
  })
})

// ─── 鉴权方式专项测试(本次重点)────────────────────────────────────────────

describe('buildCliEnv(鉴权 env 注入)', () => {
  it('透传中转 ANTHROPIC_BASE_URL + ANTHROPIC_API_KEY', () => {
    const env = buildCliEnv({
      ANTHROPIC_BASE_URL: 'https://relay.example.com',
      ANTHROPIC_API_KEY: 'sk-relay-123',
      PATH: '/usr/bin',
    } as NodeJS.ProcessEnv)
    expect(env.ANTHROPIC_BASE_URL).toBe('https://relay.example.com')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-relay-123')
  })
  it('缺失时不臆造默认值(保持 undefined)', () => {
    const env = buildCliEnv({} as NodeJS.ProcessEnv)
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  })
})

describe('claudeBinCandidates(多安装方式探测)', () => {
  it('SOURCEREALM_CLAUDE_PATH 排在首位(显式覆盖最高优先)', () => {
    const c = claudeBinCandidates({ SOURCEREALM_CLAUDE_PATH: '/custom/claude' } as NodeJS.ProcessEnv)
    expect(c[0]).toBe('/custom/claude')
  })
  it('候选列表始终以裸名 claude 兜底(走 PATH)', () => {
    const c = claudeBinCandidates({} as NodeJS.ProcessEnv)
    expect(c[c.length - 1]).toBe('claude')
  })
  it('Windows 平台包含 winget 与 npm 全局候选', () => {
    if (process.platform !== 'win32') return
    const c = claudeBinCandidates({
      LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local',
      APPDATA: 'C:\\Users\\x\\AppData\\Roaming',
    } as NodeJS.ProcessEnv)
    expect(c.some((p) => p.includes('WinGet') && p.endsWith('claude.exe'))).toBe(true)
    expect(c.some((p) => p.toLowerCase().endsWith('claude.cmd'))).toBe(true)
  })
})

describe('resolveClaudeBin', () => {
  beforeEach(() => resetClaudeBinCache())
  afterEach(() => resetClaudeBinCache())
  it('SOURCEREALM_CLAUDE_PATH 指向真实存在文件时返回它', () => {
    // 用本测试文件自身作为「存在的文件」替身
    const real = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
    expect(resolveClaudeBin({ SOURCEREALM_CLAUDE_PATH: real } as NodeJS.ProcessEnv)).toBe(real)
  })
  it('所有候选都不存在时回落到裸名 claude', () => {
    expect(resolveClaudeBin({ SOURCEREALM_CLAUDE_PATH: '/definitely/not/here/claude' } as NodeJS.ProcessEnv)).toBe(
      'claude',
    )
  })
})

describe('detectProviderMode', () => {
  const saved = process.env.SOURCEREALM_USE_CLI
  afterEach(() => {
    if (saved === undefined) delete process.env.SOURCEREALM_USE_CLI
    else process.env.SOURCEREALM_USE_CLI = saved
  })
  it('true→claude-cli, false→anthropic-api, 其它→unset', () => {
    process.env.SOURCEREALM_USE_CLI = 'true'
    expect(detectProviderMode()).toBe('claude-cli')
    process.env.SOURCEREALM_USE_CLI = 'false'
    expect(detectProviderMode()).toBe('anthropic-api')
    delete process.env.SOURCEREALM_USE_CLI
    expect(detectProviderMode()).toBe('unset')
    process.env.SOURCEREALM_USE_CLI = 'yes'
    expect(detectProviderMode()).toBe('unset')
  })
})

describe('selectProvider(第一判断源,必填,不降级)', () => {
  const savedFlag = process.env.SOURCEREALM_USE_CLI
  const savedKey = process.env.ANTHROPIC_API_KEY
  beforeEach(() => {
    delete process.env.SOURCEREALM_USE_CLI
    delete process.env.ANTHROPIC_API_KEY
  })
  afterEach(() => {
    vi.restoreAllMocks()
    if (savedFlag === undefined) delete process.env.SOURCEREALM_USE_CLI
    else process.env.SOURCEREALM_USE_CLI = savedFlag
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = savedKey
  })

  it('未设置 SOURCEREALM_USE_CLI → 抛错提示先配置', async () => {
    await expect(selectProvider()).rejects.toThrow(ProviderError)
    await expect(selectProvider()).rejects.toThrow('SOURCEREALM_USE_CLI')
  })

  it('=true 但未装 claude → 抛安装提示,且不返回 SDK(不降级)', async () => {
    process.env.SOURCEREALM_USE_CLI = 'true'
    process.env.ANTHROPIC_API_KEY = 'sk-present' // 即便有 key 也不应回退
    vi.spyOn(ClaudeCliProvider, 'available').mockResolvedValue(false)
    await expect(selectProvider()).rejects.toThrow('claude code')
  })

  it('=true 且装了 claude → 返回 ClaudeCliProvider', async () => {
    process.env.SOURCEREALM_USE_CLI = 'true'
    vi.spyOn(ClaudeCliProvider, 'available').mockResolvedValue(true)
    const p = await selectProvider()
    expect(p).toBeInstanceOf(ClaudeCliProvider)
  })

  it('=false 但未配 key → 抛配置提示,且不调用 claude 检测(不降级)', async () => {
    process.env.SOURCEREALM_USE_CLI = 'false'
    const availSpy = vi.spyOn(ClaudeCliProvider, 'available').mockResolvedValue(true)
    await expect(selectProvider()).rejects.toThrow('ANTHROPIC')
    expect(availSpy).not.toHaveBeenCalled() // 绝不探测/回退到 CLI
  })

  it('=false 且配了 key → 返回 AnthropicApiProvider', async () => {
    process.env.SOURCEREALM_USE_CLI = 'false'
    process.env.ANTHROPIC_API_KEY = 'sk-relay'
    const p = await selectProvider()
    expect(p).toBeInstanceOf(AnthropicApiProvider)
  })
})
