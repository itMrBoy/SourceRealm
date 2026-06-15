import { zodToJsonSchema } from 'zod-to-json-schema'
import type { GenerateOptions } from './types.js'

const SCHEMA_INSTRUCTION = (jsonSchema: string) =>
  `\n\n你的最终回复必须是且仅是一个 JSON 对象(不要 markdown 代码块、不要解释文字),符合此 JSON Schema:\n${jsonSchema}`

/** 构造传给 claude CLI 的 stdin prompt:基础 prompt + 探索引导 + schema 要求(不内嵌源码) */
export function buildClaudeCliPrompt<T>(opts: GenerateOptions<T>): string {
  const jsonSchema = JSON.stringify(zodToJsonSchema(opts.schema, opts.schemaName))
  const hint = opts.explorationHint ? `\n\n${opts.explorationHint}` : ''
  return opts.prompt + hint + SCHEMA_INSTRUCTION(jsonSchema)
}

/**
 * 构造传给 claude CLI 子进程的环境变量:显式注入中转 ANTHROPIC_BASE_URL + ANTHROPIC_API_KEY,
 * 强制走中转鉴权(设了 API key 时 CLI 优先用它而非本机 OAuth)。
 * 返回的对象与 execa 的 extendEnv:true 合并(继承 PATH/HOME 等);未设置的变量保持 undefined。
 * 抽成纯函数便于单测断言。
 */
export function buildCliEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
  }
}
