import Anthropic from '@anthropic-ai/sdk'
import { execa } from 'execa'
import type { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

export interface GenerateOptions<T> {
  prompt: string
  schema: z.ZodType<T>
  schemaName: string
  /** CLI 模式下让 Claude 在该目录内自行探索仓库 */
  cwd?: string
}

export interface LLMProvider {
  readonly name: string
  generate<T>(opts: GenerateOptions<T>): Promise<T>
}

export class ProviderError extends Error {}

/** 从模型输出中提取 JSON:先直接 parse,再剥代码块/前后缀 */
export function extractJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    /* fallthrough */
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) {
    try {
      return JSON.parse(fenced[1])
    } catch {
      /* fallthrough */
    }
  }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    return JSON.parse(text.slice(start, end + 1))
  }
  throw new ProviderError('模型输出中找不到 JSON')
}

/** 测试与集成用:handler 返回任意值,仍走 schema 校验 */
export class MockProvider implements LLMProvider {
  readonly name = 'mock'
  constructor(private handler: (opts: GenerateOptions<unknown>) => unknown) {}
  async generate<T>(opts: GenerateOptions<T>): Promise<T> {
    return opts.schema.parse(await this.handler(opts as GenerateOptions<unknown>))
  }
}

/** schema 校验失败时,把错误拼回 prompt 重试(共 retries 次) */
export async function generateWithRetry<T>(
  provider: LLMProvider,
  opts: GenerateOptions<T>,
  retries = 2,
): Promise<T> {
  let lastErr: unknown
  let prompt = opts.prompt
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await provider.generate({ ...opts, prompt })
    } catch (err) {
      lastErr = err
      prompt = `${opts.prompt}\n\n上一次输出不符合要求: ${String(err).slice(0, 500)}\n请严格输出符合 schema 的 JSON。`
    }
  }
  throw lastErr
}

const SCHEMA_INSTRUCTION = (jsonSchema: string) =>
  `\n\n你的最终回复必须是且仅是一个 JSON 对象(不要 markdown 代码块、不要解释文字),符合此 JSON Schema:\n${jsonSchema}`

export class ClaudeCliProvider implements LLMProvider {
  readonly name = 'claude-cli'

  static async available(): Promise<boolean> {
    return execa('claude', ['--version'], { timeout: 10_000 }).then(
      () => true,
      () => false,
    )
  }

  async generate<T>(opts: GenerateOptions<T>): Promise<T> {
    const jsonSchema = JSON.stringify(zodToJsonSchema(opts.schema, opts.schemaName))
    const { stdout } = await execa(
      'claude',
      ['-p', opts.prompt + SCHEMA_INSTRUCTION(jsonSchema), '--output-format', 'json'],
      { cwd: opts.cwd, timeout: 600_000 },
    )
    const envelope = JSON.parse(stdout) as { result?: string; is_error?: boolean }
    if (envelope.is_error || typeof envelope.result !== 'string') {
      throw new ProviderError(`claude CLI 调用失败: ${stdout.slice(0, 300)}`)
    }
    return opts.schema.parse(extractJson(envelope.result))
  }
}

export class AnthropicApiProvider implements LLMProvider {
  readonly name = 'anthropic-api'
  private client = new Anthropic()

  static available(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY)
  }

  async generate<T>(opts: GenerateOptions<T>): Promise<T> {
    const jsonSchema = zodToJsonSchema(opts.schema, opts.schemaName) as Record<string, unknown>
    const message = await this.client.messages.create({
      model: process.env.CODE_QUEST_MODEL ?? 'claude-opus-4-8',
      max_tokens: 8192,
      tools: [{ name: 'emit', description: '输出生成结果', input_schema: jsonSchema as never }],
      tool_choice: { type: 'tool', name: 'emit' },
      messages: [{ role: 'user', content: opts.prompt }],
    })
    const block = message.content.find((b) => b.type === 'tool_use')
    if (!block || block.type !== 'tool_use') throw new ProviderError('API 未返回结构化输出')
    return opts.schema.parse(block.input)
  }
}

/** 优先 claude CLI,回退 API key,都没有则报错引导配置 */
export async function detectProvider(): Promise<LLMProvider> {
  if (await ClaudeCliProvider.available()) return new ClaudeCliProvider()
  if (AnthropicApiProvider.available()) return new AnthropicApiProvider()
  throw new ProviderError(
    '未检测到可用的 AI:请安装 Claude Code CLI(https://claude.com/claude-code),或设置 ANTHROPIC_API_KEY 环境变量。',
  )
}
