import type { GenerateOptions, LLMProvider } from './types.js'

/**
 * schema 校验失败时,把错误拼回 prompt 重试(共 retries 次)。
 * 与具体 provider 解耦,任何 LLMProvider 都可复用。
 */
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
