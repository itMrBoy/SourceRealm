import open from 'open'
import { buildApp } from './app.js'

const port = Number(process.env.PORT ?? 4977)
const app = await buildApp()
await app.listen({ port })
const url = `http://localhost:${port}`
console.log(`🎮 CodeQuest 已启动: ${url}`)
console.log('   (计划 2 完成前,先用 API 访问;Ctrl+C 退出)')
if (!process.argv.includes('--no-open')) {
  await open(url).catch(() => {})
}
