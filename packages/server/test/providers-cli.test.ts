import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

// 拦截 execa,断言 ClaudeCliProvider 传给 claude 子进程的命令行参数与环境变量
const execaMock = vi.fn()
vi.mock('execa', () => ({ execa: (...args: unknown[]) => execaMock(...args) }))

const schema = z.object({ name: z.string() })

describe('ClaudeCliProvider.generate(命令形态与鉴权 env)', () => {
  afterEach(() => {
    execaMock.mockReset()
    vi.unstubAllEnvs()
  })

  it('args 不含 --bare,含只读工具与禁写工具;env 注入中转凭证;cwd 为仓库根', async () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://relay.example.com')
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-relay-xyz')
    execaMock.mockResolvedValue({ stdout: JSON.stringify({ result: '{"name":"ok"}', is_error: false }) })

    const { ClaudeCliProvider } = await import('../src/providers.js')
    const provider = new ClaudeCliProvider()
    const result = await provider.generate({
      prompt: 'p',
      schema,
      schemaName: 's',
      cwd: '/repo/root',
    })

    expect(result).toEqual({ name: 'ok' })
    expect(execaMock).toHaveBeenCalledTimes(1)
    const [bin, args, opts] = execaMock.mock.calls[0] as [string, string[], Record<string, unknown>]
    // bin 是探测到的 claude 可执行文件(裸名 'claude' 或某安装路径下的 claude[.exe/.cmd])
    expect(bin === 'claude' || /claude(\.exe|\.cmd)?$/i.test(bin)).toBe(true)
    // 决策 A:不加 --bare(要加载项目 CLAUDE.md/AGENTS.md)
    expect(args).not.toContain('--bare')
    // 放行只读探索工具
    const allowedIdx = args.indexOf('--allowedTools')
    expect(allowedIdx).toBeGreaterThanOrEqual(0)
    expect(args[allowedIdx + 1]).toBe('Read,Glob,Grep')
    // 禁写禁执行兜底
    const disallowedIdx = args.indexOf('--disallowedTools')
    expect(disallowedIdx).toBeGreaterThanOrEqual(0)
    expect(args[disallowedIdx + 1]).toBe('Write,Edit,Bash')
    // 鉴权 env 显式注入到子进程,强制走中转
    expect((opts.env as Record<string, string>).ANTHROPIC_BASE_URL).toBe('https://relay.example.com')
    expect((opts.env as Record<string, string>).ANTHROPIC_API_KEY).toBe('sk-relay-xyz')
    expect(opts.cwd).toBe('/repo/root')
  })

  it('信封 is_error 时抛 ProviderError', async () => {
    execaMock.mockResolvedValue({ stdout: JSON.stringify({ is_error: true }) })
    const { ClaudeCliProvider, ProviderError } = await import('../src/providers.js')
    await expect(new ClaudeCliProvider().generate({ prompt: 'p', schema, schemaName: 's' })).rejects.toThrow(
      ProviderError,
    )
  })
})
