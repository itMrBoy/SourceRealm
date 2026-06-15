import { ProviderError } from './types.js'

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
