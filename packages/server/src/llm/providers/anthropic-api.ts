import Anthropic from '@anthropic-ai/sdk'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { ProviderError, type GenerateOptions, type LLMProvider } from '../types.js'

const DEFAULT_MODEL = 'claude-opus-4-8'
const MAX_TOKENS = 8192

/** Anthropic SDK 直连 provider:无法自主读文件,靠内嵌上下文 + tool_use 结构化输出 */
export class AnthropicApiProvider implements LLMProvider {
  readonly name = 'anthropic-api'
  // 显式取自 env,行为只由 ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL 决定(baseURL 未设则 SDK 回落官方地址)
  private client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: process.env.ANTHROPIC_BASE_URL,
  })

  static available(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY)
  }

  async generate<T>(opts: GenerateOptions<T>): Promise<T> {
    // SDK 无法自主读文件,需把内嵌上下文(行号源码块/diff)拼到 prompt 末尾
    const embedded = (await opts.buildEmbeddedContext?.()) ?? ''
    const prompt = embedded ? `${opts.prompt}\n\n${embedded}` : opts.prompt
    const jsonSchema = zodToJsonSchema(opts.schema, opts.schemaName) as Record<string, unknown>
    const message = await this.client.messages.create({
      model: process.env.SOURCEREALM_MODEL ?? DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      tools: [{ name: 'emit', description: '输出生成结果', input_schema: jsonSchema as never }],
      tool_choice: { type: 'tool', name: 'emit' },
      messages: [{ role: 'user', content: prompt }],
    })
    const block = message.content.find((b) => b.type === 'tool_use')
    if (!block || block.type !== 'tool_use') throw new ProviderError('API 未返回结构化输出')
    return opts.schema.parse(block.input)
  }
}
