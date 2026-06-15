import { AnthropicApiProvider } from './providers/anthropic-api.js'
import { ClaudeCliProvider } from './providers/claude-cli.js'
import { ProviderError, type LLMProvider } from './types.js'

export type ProviderMode = 'claude-cli' | 'anthropic-api' | 'unset'

/**
 * 仅根据 SOURCEREALM_USE_CLI 推断当前模式(不做任何可用性探测 / 副作用),供 /api/provider 展示。
 * 'true'→'claude-cli','false'→'anthropic-api',未设置/非法→'unset'。
 */
export function detectProviderMode(env: NodeJS.ProcessEnv = process.env): ProviderMode {
  const flag = env.SOURCEREALM_USE_CLI?.trim().toLowerCase()
  if (flag === 'true') return 'claude-cli'
  if (flag === 'false') return 'anthropic-api'
  return 'unset'
}

/**
 * Provider 选择:SOURCEREALM_USE_CLI 是第一判断源且必填,系统不做任何降级。
 *   'true'  → 校验本机 claude code,走 CLI 自主探索
 *   'false' → 校验中转配置,走 SDK 直连
 *   未设置/非法 → 报错引导配置
 * 任一步未就绪都直接抛错,绝不自动选择或回退到另一模式。
 */
export async function selectProvider(): Promise<LLMProvider> {
  const mode = detectProviderMode()
  if (mode === 'unset') {
    throw new ProviderError(
      '请先配置 SOURCEREALM_USE_CLI:`true`=本地 claude code 自主探索,`false`=API Key 直连。',
    )
  }
  if (mode === 'claude-cli') {
    if (await ClaudeCliProvider.available()) return new ClaudeCliProvider()
    throw new ProviderError(
      '已选本地 CLI 模式(SOURCEREALM_USE_CLI=true),但未能运行 claude code。请确认已安装 https://claude.com/claude-code;若 claude 不在服务进程的 PATH 中(常见于 Windows winget 安装),可用 SOURCEREALM_CLAUDE_PATH 指定 claude 可执行文件的绝对路径。(不会自动降级到 API)',
    )
  }
  if (AnthropicApiProvider.available()) return new AnthropicApiProvider()
  throw new ProviderError(
    '已选 API 直连模式(SOURCEREALM_USE_CLI=false),但未配置 ANTHROPIC_API_KEY(+ ANTHROPIC_BASE_URL 指向中转),请配置后重试(不会自动降级到 CLI)。',
  )
}
