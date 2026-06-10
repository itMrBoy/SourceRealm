import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import open from 'open'
import { buildApp } from './app.js'

const port = Number(process.env.PORT ?? 4977)
const app = await buildApp()
await app.listen({ port })
const url = `http://localhost:${port}`
const distPath = path.resolve(fileURLToPath(import.meta.url), '../../../web/dist')
const hasDist = fs.existsSync(path.join(distPath, 'index.html'))
console.log(`🎮 CodeQuest 已启动: ${url}`)
if (hasDist) {
  console.log('   在浏览器中开始你的源码冒险吧!')
} else {
  console.log('   提示: 先运行 npm run build 构建前端,或使用 npm run dev -w @code-quest/web 开发模式')
}
if (!process.argv.includes('--no-open')) {
  await open(url).catch(() => {})
}
