import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import open from 'open'
import { buildApp } from './app.js'
import { loadRepoEnv } from './env.js'

// 加载仓库根目录 .env,并让本应用相关变量覆盖外部同名环境变量。
// 这样 Windows 用户级 ANTHROPIC_* 不会意外压过当前仓库配置。
const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../..')
const envFile = path.join(repoRoot, '.env')
await loadRepoEnv(envFile).catch(() => {})

const port = Number(process.env.PORT ?? 4977)
const app = await buildApp()
await app.listen({ port })
const url = `http://localhost:${port}`
const distPath = path.resolve(fileURLToPath(import.meta.url), '../../../web/dist')
const hasDist = fs.existsSync(path.join(distPath, 'index.html'))
console.log(`🎮 源界 SourceRealm 已启动: ${url}`)
if (hasDist) {
  console.log('   在浏览器中开始你的源码冒险吧!')
} else {
  console.log('   提示: 先运行 pnpm --filter @sourcerealm/web build 构建前端,或使用 pnpm --filter @sourcerealm/web dev 开发模式')
}
if (!process.argv.includes('--no-open')) {
  await open(url).catch(() => {})
}
