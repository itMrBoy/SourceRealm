/**
 * 开发用 mock 服务器:用 MockProvider 跑通「导入 → 生成 → 地图」全流程,
 * 无需真实 LLM。生成 2 章 × 2 关,每次模型调用 sleep 300ms 让进度可见。
 *
 * 用法:
 *   PORT=4977 npx tsx packages/server/scripts/dev-mock.ts
 * 然后另开 `npm run dev -w @code-quest/web`,浏览器访问 vite 端口,
 * 路径填本脚本打印出的 fixture 仓库路径。
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { buildApp } from '../src/app.js'
import { MockProvider, type GenerateOptions } from '../src/providers.js'

const AUTH_JS = `function login(user, pass) {
  if (!user) throw new Error('no user')
  return token(user)
}

function token(user) {
  return 'tk-' + user
}

module.exports = { login }
`

const DB_JS = `const store = new Map()

function get(key) {
  return store.get(key)
}

function set(key, value) {
  store.set(key, value)
}

module.exports = { get, set }
`

async function makeFixtureRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cq-mock-'))
  await fs.writeFile(path.join(dir, 'README.md'), '# demo\n一个用于 mock 演示的项目\n')
  await fs.mkdir(path.join(dir, 'src'))
  await fs.writeFile(path.join(dir, 'src/auth.js'), AUTH_JS)
  await fs.writeFile(path.join(dir, 'src/db.js'), DB_JS)
  const git = (...args: string[]) =>
    execa('git', ['-c', 'user.email=t@t.dev', '-c', 'user.name=tester', ...args], { cwd: dir })
  await git('init')
  await git('add', '.')
  await git('commit', '-m', 'init')
  return dir
}

// 2 章 × 2 关
const courseDraft = {
  projectName: 'demo',
  tagline: '一段奇妙的源码之旅',
  chapters: [
    {
      id: 'ch1',
      title: '初入江湖',
      intro: '了解项目全貌',
      levels: [
        { id: 'lv-auth', title: '登录大门', goal: '读懂 login', files: ['src/auth.js'] },
        { id: 'lv-token', title: '令牌密室', goal: '读懂 token', files: ['src/auth.js'] },
      ],
    },
    {
      id: 'ch2',
      title: '深入腹地',
      intro: '掌握数据存储',
      levels: [
        { id: 'lv-store', title: '存储宝库', goal: '读懂 store', files: ['src/db.js'] },
        { id: 'lv-getset', title: '取放之道', goal: '读懂 get/set', files: ['src/db.js'] },
      ],
    },
  ],
}

function levelDraftFor(file: string) {
  return {
    title: '关卡', summary: 's',
    tasks: [
      {
        id: 't1', type: 'quiz', narrative: '勇者啊,看看这段代码。', question: '入口函数是哪个?',
        options: ['第一个', '第二个'], answer: [0], explanation: '它是导出的入口。',
        refs: [{ file, startLine: 1, endLine: 3, contentHash: '' }],
      },
      {
        id: 't2', type: 'code-type', narrative: '临摹这段代码以记住它。', explanation: '熟能生巧。',
        ref: { file, startLine: 5, endLine: 7, contentHash: '' },
      },
    ],
  }
}

async function main(): Promise<void> {
  const repo = await makeFixtureRepo()
  const app = await buildApp({
    provider: new MockProvider(async (opts: GenerateOptions<unknown>) => {
      // 每次调用 sleep,让生成进度在前端可见
      await new Promise((r) => setTimeout(r, 300))
      if (opts.schemaName === 'course') return courseDraft
      // 出题:根据 prompt 里提到的文件返回对应 levelDraft
      const file = opts.prompt.includes('src/db.js') ? 'src/db.js' : 'src/auth.js'
      return levelDraftFor(file)
    }),
  })
  const port = Number(process.env.PORT ?? 4977)
  // 绑定所有接口,使 vite 代理通过 localhost(可能解析为 ::1)也能连上
  await app.listen({ port, host: '::' })
  console.log(`[dev-mock] 监听 http://localhost:${port}`)
  console.log(`[dev-mock] fixture 仓库: ${repo}`)
}

void main()
