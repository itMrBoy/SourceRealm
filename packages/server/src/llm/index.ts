/**
 * LLM 子系统统一出口。
 * 对外保持稳定的导入面(历史上从 `./providers.js` 导入,现由本 barrel 聚合各模块)。
 */
export type { GenerateOptions, LLMProvider } from './types.js'
export { ProviderError } from './types.js'
export { extractJson } from './json.js'
export { buildClaudeCliPrompt, buildCliEnv } from './prompt.js'
export {
  claudeBinCandidates,
  resolveClaudeBin,
  resetClaudeBinCache,
} from './claude-path.js'
export { generateWithRetry } from './retry.js'
export { MockProvider } from './providers/mock.js'
export { ClaudeCliProvider } from './providers/claude-cli.js'
export { AnthropicApiProvider } from './providers/anthropic-api.js'
export { detectProviderMode, selectProvider, type ProviderMode } from './select.js'
