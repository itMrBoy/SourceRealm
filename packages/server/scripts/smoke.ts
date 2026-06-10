/** 手动冒烟:验证真实 Provider 可用且能产出合法 JSON。用法: npm run smoke -w @code-quest/server */
import { z } from 'zod'
import { detectProvider, generateWithRetry } from '../src/providers.js'

const provider = await detectProvider()
console.log(`使用 Provider: ${provider.name}`)
const result = await generateWithRetry(provider, {
  prompt: '用一句话介绍「源码阅读」的乐趣。',
  schema: z.object({ message: z.string() }),
  schemaName: 'smoke',
})
console.log('✅ 冒烟通过:', result.message)
