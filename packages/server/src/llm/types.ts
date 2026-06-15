import type { z } from 'zod'

export interface GenerateOptions<T> {
  prompt: string
  schema: z.ZodType<T>
  schemaName: string
  /** CLI 模式下让 Claude 在该目录内自行探索仓库 */
  cwd?: string
  /**
   * 惰性内嵌上下文:仅 SDK(AnthropicApiProvider)模式调用,返回需要内嵌进 prompt 的
   * 行号源码块 / diff 等。CLI 模式忽略它(改由 claude 自主 Read 文件),从而不在主控进程堆积 context。
   */
  buildEmbeddedContext?: () => Promise<string>
  /** 仅 CLI 模式追加到 prompt:引导 claude 用 Read/Glob/Grep 自主探索仓库、按真实行号作答 */
  explorationHint?: string
}

export interface LLMProvider {
  readonly name: string
  generate<T>(opts: GenerateOptions<T>): Promise<T>
}

export class ProviderError extends Error {}
