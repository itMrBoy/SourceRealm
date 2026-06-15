import type { GenerateOptions, LLMProvider } from '../types.js'

/** 测试与集成用:handler 返回任意值,仍走 schema 校验 */
export class MockProvider implements LLMProvider {
  readonly name = 'mock'
  constructor(private handler: (opts: GenerateOptions<unknown>) => unknown) {}
  async generate<T>(opts: GenerateOptions<T>): Promise<T> {
    return opts.schema.parse(await this.handler(opts as GenerateOptions<unknown>))
  }
}
