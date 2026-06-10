# CodeQuest 核心引擎 Implementation Plan (计划 1/3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建源码闯关阅读器的核心引擎:导入本地仓库 → AI 生成闯关课程 → 通过 HTTP API 提供关卡、源码与进度服务。

**Architecture:** npm workspaces monorepo,三个包:`shared`(zod schema + 判定/计分纯函数)、`server`(Fastify + RepoScanner + 可插拔 LLMProvider + LevelGenerator + JSON 文件存储)、`web`(计划 2)。所有生成数据落盘到 `~/.code-quest/<projectId>/` 的 JSON 文件。LLM 输出全部经 zod 校验,失败自动重试。

**Tech Stack:** TypeScript (ESM)、Fastify 4、zod 3、zod-to-json-schema、execa、@anthropic-ai/sdk、Vitest、tsx

**设计文档:** `docs/superpowers/specs/2025-06-10-codequest-design.md`

---

## 文件结构总览

```
package.json                          # workspaces 根
tsconfig.base.json
vitest.config.ts
packages/shared/
  package.json
  src/index.ts                        # 统一导出
  src/schema.ts                       # 所有 zod schema + TS 类型
  src/judge.ts                        # 四类任务判定纯函数
  src/scoring.ts                      # XP/连击/评级/称号/徽章纯函数
  test/schema.test.ts
  test/judge.test.ts
  test/scoring.test.ts
packages/server/
  package.json
  src/scanner.ts                      # RepoScanner:目录树/git/读代码/hash 校验
  src/store.ts                        # ProjectStore:JSON 落盘(原子写)
  src/providers.ts                    # LLMProvider 接口 + Mock/CLI/API 实现 + 重试
  src/generator.ts                    # LevelGenerator:测绘+出题管线
  src/app.ts                          # Fastify 路由 + SSE
  src/cli.ts                          # 启动入口
  scripts/smoke.ts                    # 真实 LLM 冒烟脚本(不进 CI)
  test/helpers.ts                     # fixture git 仓库构造器
  test/scanner.test.ts
  test/store.test.ts
  test/providers.test.ts
  test/generator.test.ts
  test/app.test.ts
```

---

### Task 1: Monorepo 脚手架

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`
- Create: `packages/server/package.json`, `packages/server/tsconfig.json`

- [ ] **Step 1: 创建根配置**

`package.json`:
```json
{
  "name": "code-quest",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "vitest run",
    "dev": "npm run dev -w @code-quest/server"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  }
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    testTimeout: 20_000,
  },
})
```

`.gitignore`:
```
node_modules/
dist/
.DS_Store
```

- [ ] **Step 2: 创建包配置**

`packages/shared/package.json`:
```json
{
  "name": "@code-quest/shared",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "zod": "^3.23.0" }
}
```

`packages/shared/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/server/package.json`:
```json
{
  "name": "@code-quest/server",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx src/cli.ts",
    "smoke": "tsx scripts/smoke.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.27.0",
    "@code-quest/shared": "*",
    "execa": "^9.3.0",
    "fastify": "^4.28.0",
    "open": "^10.1.0",
    "tsx": "^4.15.0",
    "zod": "^3.23.0",
    "zod-to-json-schema": "^3.23.0"
  }
}
```

`packages/server/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test", "scripts"] }
```

- [ ] **Step 3: 安装依赖并验证**

Run: `npm install && npx vitest run --passWithNoTests`
Expected: 安装成功,vitest 输出 "No test files found" 且退出码 0

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: monorepo scaffold (shared + server packages)"
```

---

### Task 2: shared — 数据 Schema

**Files:**
- Create: `packages/shared/src/schema.ts`, `packages/shared/src/index.ts`
- Test: `packages/shared/test/schema.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/shared/test/schema.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { CodeRefSchema, LevelSchema, CourseSchema, ProgressSchema, TaskSchema } from '../src/index.js'

const ref = { file: 'src/auth.js', startLine: 1, endLine: 4, contentHash: 'abc123' }

describe('CodeRefSchema', () => {
  it('接受合法引用', () => {
    expect(CodeRefSchema.parse(ref)).toEqual(ref)
  })
  it('拒绝 endLine < startLine', () => {
    expect(() => CodeRefSchema.parse({ ...ref, endLine: 0 })).toThrow()
  })
})

describe('TaskSchema', () => {
  it('按 type 区分任务', () => {
    const quiz = {
      id: 't1', type: 'quiz', narrative: '欢迎来到登录大门!', question: 'login 做了什么?',
      options: ['校验用户', '发邮件'], answer: [0], explanation: '它校验用户并签发 token', refs: [ref],
    }
    expect(TaskSchema.parse(quiz).type).toBe('quiz')
    expect(() => TaskSchema.parse({ ...quiz, type: 'unknown' })).toThrow()
  })
  it('call-chain 要求 order 与 items 数量一致', () => {
    const chain = {
      id: 't2', type: 'call-chain', narrative: 'n', explanation: 'e',
      items: [{ label: 'a' }, { label: 'b' }, { label: 'c' }], order: [2, 0],
    }
    expect(() => TaskSchema.parse(chain)).toThrow()
    expect(TaskSchema.parse({ ...chain, order: [2, 0, 1] }).type).toBe('call-chain')
  })
})

describe('Course/Level/Progress', () => {
  it('解析完整课程大纲', () => {
    const course = {
      projectName: 'demo', tagline: '一段奇妙的源码之旅',
      chapters: [{
        id: 'ch1', title: '初入江湖', intro: '了解项目全貌',
        levels: [{ id: 'lv1', title: '入口探秘', goal: '找到启动入口', files: ['src/auth.js'], status: 'pending' }],
      }],
    }
    expect(CourseSchema.parse(course).chapters[0].levels[0].status).toBe('pending')
  })
  it('解析关卡与进度', () => {
    const level = {
      id: 'lv1', chapterId: 'ch1', title: '入口探秘', summary: 's', files: ['src/auth.js'],
      status: 'ready',
      tasks: [{ id: 't1', type: 'code-type', narrative: 'n', explanation: 'e', ref }],
    }
    expect(LevelSchema.parse(level).tasks).toHaveLength(1)
    const progress = { xp: 10, completedLevels: { lv1: { rating: 'S', accuracy: 1, maxCombo: 3, xp: 10 } }, badges: ['first-level'], filesRead: ['src/auth.js'] }
    expect(ProgressSchema.parse(progress).xp).toBe(10)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run packages/shared/test/schema.test.ts`
Expected: FAIL — 模块 `../src/index.js` 不存在

- [ ] **Step 3: 实现 schema**

`packages/shared/src/schema.ts`:
```ts
import { z } from 'zod'

export const CodeRefSchema = z
  .object({
    file: z.string().min(1),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    contentHash: z.string(),
  })
  .refine((r) => r.endLine >= r.startLine, { message: 'endLine 必须 >= startLine' })
export type CodeRef = z.infer<typeof CodeRefSchema>

const taskBase = {
  id: z.string().min(1),
  narrative: z.string().min(1),
  explanation: z.string().min(1),
}

export const QuizTaskSchema = z.object({
  ...taskBase,
  type: z.literal('quiz'),
  question: z.string().min(1),
  options: z.array(z.string()).min(2).max(4),
  answer: z.array(z.number().int().nonnegative()).min(1),
  refs: z.array(CodeRefSchema),
})

export const TreasureHuntTaskSchema = z.object({
  ...taskBase,
  type: z.literal('treasure-hunt'),
  instruction: z.string().min(1),
  hint: z.string(),
  target: CodeRefSchema,
})

export const CallChainTaskSchema = z
  .object({
    ...taskBase,
    type: z.literal('call-chain'),
    items: z.array(z.object({ label: z.string().min(1), ref: CodeRefSchema.optional() })).min(3).max(6),
    order: z.array(z.number().int().nonnegative()),
  })
  .refine((t) => t.order.length === t.items.length && new Set(t.order).size === t.items.length, {
    message: 'order 必须是 items 下标的一个排列',
  })

export const CodeFillTaskSchema = z
  .object({
    ...taskBase,
    type: z.literal('code-fill'),
    ref: CodeRefSchema,
    blankLines: z.array(z.number().int().positive()).min(1).max(3),
    answers: z.array(z.string().min(1)),
  })
  .refine((t) => t.blankLines.length === t.answers.length, { message: 'answers 与 blankLines 数量一致' })

export const CodeTypeTaskSchema = z.object({
  ...taskBase,
  type: z.literal('code-type'),
  ref: CodeRefSchema,
})

export const TaskSchema = z.discriminatedUnion('type', [
  QuizTaskSchema,
  TreasureHuntTaskSchema,
  CallChainTaskSchema,
  CodeFillTaskSchema,
  CodeTypeTaskSchema,
])
export type Task = z.infer<typeof TaskSchema>
export type TaskType = Task['type']

export const LevelStatusSchema = z.enum(['pending', 'generating', 'ready', 'failed', 'stale', 'obsolete'])
export type LevelStatus = z.infer<typeof LevelStatusSchema>

export const LevelOutlineSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  goal: z.string().min(1),
  files: z.array(z.string()),
  status: LevelStatusSchema,
})
export type LevelOutline = z.infer<typeof LevelOutlineSchema>

export const ChapterSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  intro: z.string().min(1),
  levels: z.array(LevelOutlineSchema).min(1),
})
export type Chapter = z.infer<typeof ChapterSchema>

export const CourseSchema = z.object({
  projectName: z.string().min(1),
  tagline: z.string().min(1),
  chapters: z.array(ChapterSchema).min(1),
})
export type Course = z.infer<typeof CourseSchema>

export const LevelSchema = z.object({
  id: z.string().min(1),
  chapterId: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  files: z.array(z.string()),
  status: LevelStatusSchema,
  tasks: z.array(TaskSchema).min(1),
})
export type Level = z.infer<typeof LevelSchema>

export const RatingSchema = z.enum(['S', 'A', 'B', 'C'])
export type Rating = z.infer<typeof RatingSchema>

export const LevelResultSchema = z.object({
  rating: RatingSchema,
  accuracy: z.number().min(0).max(1),
  maxCombo: z.number().int().nonnegative(),
  xp: z.number().int().nonnegative(),
})
export type LevelResult = z.infer<typeof LevelResultSchema>

export const ProgressSchema = z.object({
  xp: z.number().int().nonnegative(),
  completedLevels: z.record(z.string(), LevelResultSchema),
  badges: z.array(z.string()),
  filesRead: z.array(z.string()),
})
export type Progress = z.infer<typeof ProgressSchema>

export const GenerationStatusSchema = z.enum(['idle', 'mapping', 'generating', 'done', 'error'])

export const ProjectMetaSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  name: z.string().min(1),
  isGit: z.boolean(),
  anchorCommit: z.string().nullable(),
  createdAt: z.string(),
  generation: z.object({
    status: GenerationStatusSchema,
    error: z.string().optional(),
  }),
})
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>
```

`packages/shared/src/index.ts`:
```ts
export * from './schema.js'
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run packages/shared/test/schema.test.ts`
Expected: PASS(全部用例)

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): zod schemas for course/level/task/progress"
```

---

### Task 3: shared — 任务判定纯函数

**Files:**
- Create: `packages/shared/src/judge.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/judge.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/shared/test/judge.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { judgeQuiz, judgeTreasureHunt, judgeCallChain, judgeCodeFill, judgeCodeType, normalizeCode } from '../src/index.js'

describe('judgeQuiz', () => {
  it('选项集合相等即正确(顺序无关)', () => {
    expect(judgeQuiz([0, 2], [2, 0])).toBe(true)
    expect(judgeQuiz([0, 2], [0])).toBe(false)
    expect(judgeQuiz([1], [1])).toBe(true)
  })
})

describe('judgeTreasureHunt', () => {
  const target = { file: 'src/auth.js', startLine: 2, endLine: 4, contentHash: '' }
  it('同文件且行号落在范围内即命中', () => {
    expect(judgeTreasureHunt(target, { file: 'src/auth.js', line: 3 })).toBe(true)
    expect(judgeTreasureHunt(target, { file: 'src/auth.js', line: 5 })).toBe(false)
    expect(judgeTreasureHunt(target, { file: 'src/other.js', line: 3 })).toBe(false)
  })
})

describe('judgeCallChain', () => {
  it('序列完全一致即正确', () => {
    expect(judgeCallChain([2, 0, 1], [2, 0, 1])).toBe(true)
    expect(judgeCallChain([2, 0, 1], [0, 2, 1])).toBe(false)
  })
})

describe('judgeCodeFill', () => {
  it('逐空比对,忽略空白差异', () => {
    expect(judgeCodeFill(['return token(user)'], ['  return   token(user) '])).toBe(true)
    expect(judgeCodeFill(['return token(user)'], ['return token(x)'])).toBe(false)
    expect(judgeCodeFill(['a', 'b'], ['a'])).toBe(false)
  })
})

describe('judgeCodeType', () => {
  it('逐字符比对并统计准确率', () => {
    expect(judgeCodeType('abc', 'abc')).toEqual({ correct: 3, accuracy: 1, complete: true })
    const r = judgeCodeType('abc', 'axc')
    expect(r.correct).toBe(2)
    expect(r.accuracy).toBeCloseTo(2 / 3)
    expect(r.complete).toBe(false)
    expect(judgeCodeType('abc', '')).toEqual({ correct: 0, accuracy: 1, complete: false })
  })
})

describe('normalizeCode', () => {
  it('压缩空白、去空行', () => {
    expect(normalizeCode('  a =  1 \n\n  b=2  ')).toBe('a = 1\nb=2')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run packages/shared/test/judge.test.ts`
Expected: FAIL — judgeQuiz 等未导出

- [ ] **Step 3: 实现判定函数**

`packages/shared/src/judge.ts`:
```ts
import type { CodeRef } from './schema.js'

/** quiz:选项集合相等(顺序无关) */
export function judgeQuiz(answer: number[], selected: number[]): boolean {
  if (answer.length !== selected.length) return false
  const want = new Set(answer)
  return selected.every((i) => want.has(i)) && new Set(selected).size === answer.length
}

/** treasure-hunt:点击位置落在目标文件的行范围内 */
export function judgeTreasureHunt(target: CodeRef, pick: { file: string; line: number }): boolean {
  return pick.file === target.file && pick.line >= target.startLine && pick.line <= target.endLine
}

/** call-chain:顺序完全一致 */
export function judgeCallChain(order: number[], submitted: number[]): boolean {
  return order.length === submitted.length && order.every((v, i) => v === submitted[i])
}

/** 压缩行内空白、去首尾空白、去空行 —— code-fill 比对用 */
export function normalizeCode(s: string): string {
  return s
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/** code-fill:逐空比对(忽略空白差异) */
export function judgeCodeFill(answers: string[], submitted: string[]): boolean {
  if (answers.length !== submitted.length) return false
  return answers.every((a, i) => normalizeCode(a) === normalizeCode(submitted[i] ?? ''))
}

/** code-type:逐字符比对。accuracy = 已输入字符中正确的比例(空输入计 1) */
export function judgeCodeType(expected: string, typed: string): { correct: number; accuracy: number; complete: boolean } {
  let correct = 0
  for (let i = 0; i < typed.length && i < expected.length; i++) {
    if (typed[i] === expected[i]) correct++
  }
  return {
    correct,
    accuracy: typed.length === 0 ? 1 : correct / typed.length,
    complete: typed === expected,
  }
}
```

`packages/shared/src/index.ts` 改为:
```ts
export * from './schema.js'
export * from './judge.js'
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run packages/shared/test/judge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): pure judging functions for 4 task types"
```

---

### Task 4: shared — 计分/评级/称号/徽章

**Files:**
- Create: `packages/shared/src/scoring.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/scoring.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/shared/test/scoring.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { taskXp, rateLevel, levelInfo, applyLevelResult, emptyProgress } from '../src/index.js'
import type { Course } from '../src/index.js'

describe('taskXp', () => {
  it('基础分 × 连击系数(上限 2 倍,四舍五入)', () => {
    expect(taskXp('quiz', 0)).toBe(10)
    expect(taskXp('quiz', 3)).toBe(13)
    expect(taskXp('code-type', 20)).toBe(50) // 25 * 2(封顶)
  })
})

describe('rateLevel', () => {
  it('S 要求全对且满连击;A>=0.9;B>=0.7;否则 C', () => {
    expect(rateLevel(1, 5, 5)).toBe('S')
    expect(rateLevel(1, 4, 5)).toBe('A')
    expect(rateLevel(0.9, 0, 5)).toBe('A')
    expect(rateLevel(0.7, 0, 5)).toBe('B')
    expect(rateLevel(0.5, 0, 5)).toBe('C')
  })
})

describe('levelInfo', () => {
  it('由 XP 推等级与称号', () => {
    expect(levelInfo(0)).toEqual({ level: 1, title: '见习读者', nextAt: 300 })
    expect(levelInfo(300).title).toBe('代码学徒')
    expect(levelInfo(9999)).toEqual({ level: 4, title: '源码宗师', nextAt: null })
  })
})

const course: Course = {
  projectName: 'demo', tagline: 't',
  chapters: [
    { id: 'ch1', title: 'c1', intro: 'i', levels: [
      { id: 'lv1', title: 'l1', goal: 'g', files: [], status: 'ready' },
      { id: 'lv2', title: 'l2', goal: 'g', files: [], status: 'ready' },
    ]},
  ],
}

describe('applyLevelResult', () => {
  it('累计 XP、记录通关、发首关与满连击徽章', () => {
    const { progress, newBadges } = applyLevelResult(emptyProgress(), course, {
      levelId: 'lv1', result: { rating: 'S', accuracy: 1, maxCombo: 4, xp: 60 }, taskCount: 4,
    })
    expect(progress.xp).toBe(60)
    expect(progress.completedLevels.lv1.rating).toBe('S')
    expect(newBadges).toContain('first-level')
    expect(newBadges).toContain('full-combo')
  })
  it('通关整章发章节徽章,全部通关发毕业徽章,重复不再发', () => {
    let p = emptyProgress()
    p = applyLevelResult(p, course, { levelId: 'lv1', result: { rating: 'A', accuracy: 0.9, maxCombo: 1, xp: 10 }, taskCount: 4 }).progress
    const r2 = applyLevelResult(p, course, { levelId: 'lv2', result: { rating: 'A', accuracy: 0.9, maxCombo: 1, xp: 10 }, taskCount: 4 })
    expect(r2.newBadges).toContain('chapter-ch1')
    expect(r2.newBadges).toContain('graduate')
    const r3 = applyLevelResult(r2.progress, course, { levelId: 'lv2', result: { rating: 'A', accuracy: 0.9, maxCombo: 1, xp: 10 }, taskCount: 4 })
    expect(r3.newBadges).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run packages/shared/test/scoring.test.ts`
Expected: FAIL — taskXp 等未导出

- [ ] **Step 3: 实现计分模块**

`packages/shared/src/scoring.ts`:
```ts
import type { Course, LevelResult, Progress, Rating, TaskType } from './schema.js'

export const BASE_XP: Record<TaskType, number> = {
  quiz: 10,
  'treasure-hunt': 15,
  'call-chain': 20,
  'code-fill': 20,
  'code-type': 25,
}

/** 连击系数:1 + 0.1×连击,封顶 2 倍 */
export function comboMultiplier(combo: number): number {
  return Math.min(1 + combo * 0.1, 2)
}

export function taskXp(type: TaskType, combo: number): number {
  return Math.round(BASE_XP[type] * comboMultiplier(combo))
}

/** S:全对且满连击;A:准确率>=0.9;B:>=0.7;否则 C */
export function rateLevel(accuracy: number, maxCombo: number, taskCount: number): Rating {
  if (accuracy >= 1 && maxCombo >= taskCount) return 'S'
  if (accuracy >= 0.9) return 'A'
  if (accuracy >= 0.7) return 'B'
  return 'C'
}

export const TITLES = [
  { xp: 0, title: '见习读者' },
  { xp: 300, title: '代码学徒' },
  { xp: 800, title: '架构行者' },
  { xp: 1600, title: '源码宗师' },
] as const

export function levelInfo(xp: number): { level: number; title: string; nextAt: number | null } {
  let idx = 0
  for (let i = 0; i < TITLES.length; i++) if (xp >= TITLES[i].xp) idx = i
  return {
    level: idx + 1,
    title: TITLES[idx].title,
    nextAt: idx + 1 < TITLES.length ? TITLES[idx + 1].xp : null,
  }
}

export function emptyProgress(): Progress {
  return { xp: 0, completedLevels: {}, badges: [], filesRead: [] }
}

export interface LevelCompletion {
  levelId: string
  result: LevelResult
  taskCount: number
}

/** 合并一次通关结果,返回新进度与新获徽章(纯函数) */
export function applyLevelResult(
  progress: Progress,
  course: Course,
  completion: LevelCompletion,
): { progress: Progress; newBadges: string[] } {
  const { levelId, result, taskCount } = completion
  const completedLevels = { ...progress.completedLevels, [levelId]: result }
  const earned: string[] = []
  const has = (b: string) => progress.badges.includes(b) || earned.includes(b)

  if (!has('first-level')) earned.push('first-level')
  if (result.maxCombo >= taskCount && taskCount > 0 && !has('full-combo')) earned.push('full-combo')
  for (const ch of course.chapters) {
    const done = ch.levels.every((lv) => lv.status === 'obsolete' || completedLevels[lv.id])
    if (done && !has(`chapter-${ch.id}`)) earned.push(`chapter-${ch.id}`)
  }
  const allDone = course.chapters.every((ch) =>
    ch.levels.every((lv) => lv.status === 'obsolete' || completedLevels[lv.id]),
  )
  if (allDone && !has('graduate')) earned.push('graduate')

  if (progress.filesRead.length >= 50 && !has('archaeologist')) earned.push('archaeologist')

  return {
    progress: { ...progress, xp: progress.xp + result.xp, completedLevels, badges: [...progress.badges, ...earned] },
    newBadges: earned,
  }
}

/** 徽章中文文案(前端展示用) */
export const BADGE_INFO: Record<string, { title: string; desc: string }> = {
  'first-level': { title: '初窥门径', desc: '通过第一个关卡' },
  'full-combo': { title: '一气呵成', desc: '满连击通关' },
  graduate: { title: '通关达人', desc: '通关全部关卡' },
  archaeologist: { title: '考古学家', desc: '累计阅读 50 个文件' },
}
```

`packages/shared/src/index.ts` 改为:
```ts
export * from './schema.js'
export * from './judge.js'
export * from './scoring.js'
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run packages/shared/test/scoring.test.ts`
Expected: PASS

- [ ] **Step 5: 跑全部测试 + Commit**

Run: `npx vitest run`
Expected: 全部 PASS

```bash
git add packages/shared
git commit -m "feat(shared): xp/combo/rating/title/badge scoring"
```

---

### Task 5: server — RepoScanner

**Files:**
- Create: `packages/server/src/scanner.ts`
- Create: `packages/server/test/helpers.ts`
- Test: `packages/server/test/scanner.test.ts`

- [ ] **Step 1: 写 fixture 仓库构造器**

`packages/server/test/helpers.ts`:
```ts
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execa } from 'execa'

export const AUTH_JS = `function login(user, pass) {
  if (!user) throw new Error('no user')
  return token(user)
}

function token(user) {
  return 'tk-' + user
}

module.exports = { login }
`

/** 创建一个带 1 个 commit 的临时 git 仓库,返回路径 */
export async function makeFixtureRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cq-fixture-'))
  await fs.writeFile(path.join(dir, 'README.md'), '# demo\n一个演示项目\n')
  await fs.mkdir(path.join(dir, 'src'))
  await fs.writeFile(path.join(dir, 'src/auth.js'), AUTH_JS)
  const git = (...args: string[]) =>
    execa('git', ['-c', 'user.email=t@t.dev', '-c', 'user.name=tester', ...args], { cwd: dir })
  await git('init')
  await git('add', '.')
  await git('commit', '-m', 'init')
  return dir
}

/** 临时数据目录(隔离 ~/.code-quest) */
export async function makeDataHome(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cq-home-'))
  process.env.CODE_QUEST_HOME = dir
  return dir
}
```

- [ ] **Step 2: 写失败测试**

`packages/server/test/scanner.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { RepoScanner, hashLines } from '../src/scanner.js'
import { makeFixtureRepo, AUTH_JS } from './helpers.js'

describe('RepoScanner', () => {
  it('拒绝不存在的路径', async () => {
    await expect(RepoScanner.open('/no/such/dir-xyz')).rejects.toThrow('不是有效目录')
  })

  it('识别 git 仓库并读取 HEAD', async () => {
    const dir = await makeFixtureRepo()
    const scanner = await RepoScanner.open(dir)
    expect(scanner.isGit).toBe(true)
    expect(await scanner.head()).toMatch(/^[0-9a-f]{40}$/)
  })

  it('列出文件树(git ls-files)', async () => {
    const scanner = await RepoScanner.open(await makeFixtureRepo())
    const tree = await scanner.fileTree()
    expect(tree).toContain('README.md')
    expect(tree).toContain('src/auth.js')
  })

  it('读取文件并阻止路径穿越', async () => {
    const scanner = await RepoScanner.open(await makeFixtureRepo())
    expect(await scanner.readFile('src/auth.js')).toBe(AUTH_JS)
    await expect(scanner.readFile('../etc/passwd')).rejects.toThrow('非法路径')
  })

  it('readRef 返回片段文本并校验 hash', async () => {
    const scanner = await RepoScanner.open(await makeFixtureRepo())
    const lines = AUTH_JS.split('\n').slice(0, 4).join('\n')
    const ref = { file: 'src/auth.js', startLine: 1, endLine: 4, contentHash: hashLines(lines) }
    const got = await scanner.readRef(ref)
    expect(got.fresh).toBe(true)
    expect(got.text).toContain('function login')
    const stale = await scanner.readRef({ ...ref, contentHash: 'deadbeef' })
    expect(stale.fresh).toBe(false)
    const oob = await scanner.readRef({ ...ref, startLine: 999, endLine: 1000 })
    expect(oob.fresh).toBe(false)
  })
})
```

- [ ] **Step 3: 运行确认失败**

Run: `npx vitest run packages/server/test/scanner.test.ts`
Expected: FAIL — `../src/scanner.js` 不存在

- [ ] **Step 4: 实现 RepoScanner**

`packages/server/src/scanner.ts`:
```ts
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execa } from 'execa'
import type { CodeRef } from '@code-quest/shared'

const MAX_FILES = 5000
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'vendor'])

/** 对片段文本(去尾随空白)取 sha256 前 16 位 */
export function hashLines(text: string): string {
  const norm = text.split('\n').map((l) => l.trimEnd()).join('\n')
  return createHash('sha256').update(norm).digest('hex').slice(0, 16)
}

export class RepoScanner {
  private constructor(
    readonly root: string,
    readonly isGit: boolean,
  ) {}

  static async open(p: string): Promise<RepoScanner> {
    const root = path.resolve(p)
    const stat = await fs.stat(root).catch(() => null)
    if (!stat?.isDirectory()) throw new Error(`不是有效目录: ${root}`)
    const isGit = await execa('git', ['rev-parse', '--git-dir'], { cwd: root }).then(
      () => true,
      () => false,
    )
    return new RepoScanner(root, isGit)
  }

  /** 当前 HEAD commit;非 git 或空仓库返回 null */
  async head(): Promise<string | null> {
    if (!this.isGit) return null
    try {
      const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd: this.root })
      return stdout || null
    } catch {
      return null
    }
  }

  async fileTree(): Promise<string[]> {
    if (this.isGit) {
      const { stdout } = await execa('git', ['ls-files'], { cwd: this.root })
      return stdout ? stdout.split('\n').slice(0, MAX_FILES) : []
    }
    const out: string[] = []
    const walk = async (dir: string): Promise<void> => {
      if (out.length >= MAX_FILES) return
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (out.length >= MAX_FILES) return
        const abs = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) await walk(abs)
        } else {
          out.push(path.relative(this.root, abs))
        }
      }
    }
    await walk(this.root)
    return out
  }

  private resolveInside(rel: string): string {
    const abs = path.resolve(this.root, rel)
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) throw new Error(`非法路径: ${rel}`)
    return abs
  }

  async readFile(rel: string): Promise<string> {
    return fs.readFile(this.resolveInside(rel), 'utf8')
  }

  /** 读取引用片段;文件缺失/越界/被改都体现在 fresh=false */
  async readRef(ref: CodeRef): Promise<{ text: string; actualHash: string; fresh: boolean }> {
    let content: string
    try {
      content = await this.readFile(ref.file)
    } catch {
      return { text: '', actualHash: '', fresh: false }
    }
    const lines = content.split('\n')
    if (ref.startLine > lines.length || ref.endLine > lines.length) {
      return { text: '', actualHash: '', fresh: false }
    }
    const text = lines.slice(ref.startLine - 1, ref.endLine).join('\n')
    const actualHash = hashLines(text)
    return { text, actualHash, fresh: actualHash === ref.contentHash }
  }
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run packages/server/test/scanner.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/server
git commit -m "feat(server): RepoScanner with git support and code-ref hashing"
```

---

### Task 6: server — ProjectStore(JSON 落盘)

**Files:**
- Create: `packages/server/src/store.ts`
- Test: `packages/server/test/store.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/server/test/store.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore, projectIdFor } from '../src/store.js'
import { emptyProgress } from '@code-quest/shared'
import type { Level, ProjectMeta } from '@code-quest/shared'
import { makeDataHome } from './helpers.js'

const meta: ProjectMeta = {
  id: 'abc123', path: '/tmp/demo', name: 'demo', isGit: true,
  anchorCommit: 'deadbeef', createdAt: '2025-06-10T00:00:00Z',
  generation: { status: 'idle' },
}

const level: Level = {
  id: 'lv1', chapterId: 'ch1', title: 't', summary: 's', files: ['a.js'], status: 'ready',
  tasks: [{
    id: 't1', type: 'quiz', narrative: 'n', explanation: 'e', question: 'q',
    options: ['a', 'b'], answer: [0], refs: [],
  }],
}

describe('ProjectStore', () => {
  beforeEach(async () => {
    await makeDataHome()
  })

  it('projectIdFor 对同一路径稳定', () => {
    expect(projectIdFor('/tmp/demo')).toBe(projectIdFor('/tmp/demo'))
    expect(projectIdFor('/tmp/demo')).toHaveLength(12)
  })

  it('meta/course/progress/level 读写往返', async () => {
    const store = new ProjectStore('abc123')
    expect(await store.readMeta()).toBeNull()
    await store.writeMeta(meta)
    expect((await store.readMeta())!.name).toBe('demo')

    await store.writeProgress(emptyProgress())
    expect((await store.readProgress())!.xp).toBe(0)

    await store.writeLevel(level)
    expect((await store.readLevel('lv1'))!.tasks).toHaveLength(1)
    expect(await store.readLevel('nope')).toBeNull()
  })

  it('写入不合 schema 的数据直接抛错', async () => {
    const store = new ProjectStore('abc123')
    await expect(store.writeMeta({ bad: true } as never)).rejects.toThrow()
  })

  it('list 列出全部项目', async () => {
    const store = new ProjectStore('abc123')
    await store.writeMeta(meta)
    const all = await ProjectStore.list()
    expect(all.map((m) => m.id)).toContain('abc123')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run packages/server/test/store.test.ts`
Expected: FAIL — `../src/store.js` 不存在

- [ ] **Step 3: 实现 ProjectStore**

`packages/server/src/store.ts`:
```ts
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { z } from 'zod'
import {
  CourseSchema,
  LevelSchema,
  ProgressSchema,
  ProjectMetaSchema,
  type Course,
  type Level,
  type Progress,
  type ProjectMeta,
} from '@code-quest/shared'

export function dataRoot(): string {
  return process.env.CODE_QUEST_HOME ?? path.join(os.homedir(), '.code-quest')
}

export function projectIdFor(repoPath: string): string {
  return createHash('sha256').update(path.resolve(repoPath)).digest('hex').slice(0, 12)
}

export class ProjectStore {
  constructor(readonly id: string) {}

  get dir(): string {
    return path.join(dataRoot(), this.id)
  }

  private async readJson<T>(file: string, schema: z.ZodType<T>): Promise<T | null> {
    try {
      const raw = await fs.readFile(path.join(this.dir, file), 'utf8')
      return schema.parse(JSON.parse(raw))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  /** 原子写:先写临时文件再 rename */
  private async writeJson<T>(file: string, schema: z.ZodType<T>, value: T): Promise<void> {
    const parsed = schema.parse(value)
    const target = path.join(this.dir, file)
    await fs.mkdir(path.dirname(target), { recursive: true })
    const tmp = `${target}.${randomUUID()}.tmp`
    await fs.writeFile(tmp, JSON.stringify(parsed, null, 2))
    await fs.rename(tmp, target)
  }

  readMeta() { return this.readJson('project.json', ProjectMetaSchema) }
  writeMeta(v: ProjectMeta) { return this.writeJson('project.json', ProjectMetaSchema, v) }
  readCourse() { return this.readJson('course.json', CourseSchema) }
  writeCourse(v: Course) { return this.writeJson('course.json', CourseSchema, v) }
  readProgress() { return this.readJson('progress.json', ProgressSchema) }
  writeProgress(v: Progress) { return this.writeJson('progress.json', ProgressSchema, v) }
  readLevel(id: string) { return this.readJson(path.join('levels', `${id}.json`), LevelSchema) }
  writeLevel(v: Level) { return this.writeJson(path.join('levels', `${v.id}.json`), LevelSchema, v) }

  static async list(): Promise<ProjectMeta[]> {
    let ids: string[]
    try {
      ids = await fs.readdir(dataRoot())
    } catch {
      return []
    }
    const metas = await Promise.all(ids.map((id) => new ProjectStore(id).readMeta().catch(() => null)))
    return metas.filter((m): m is ProjectMeta => m !== null)
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run packages/server/test/store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server
git commit -m "feat(server): ProjectStore JSON persistence with atomic writes"
```

---

### Task 7: server — LLMProvider(接口 + Mock + CLI + API + 重试)

**Files:**
- Create: `packages/server/src/providers.ts`
- Test: `packages/server/test/providers.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/server/test/providers.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { MockProvider, extractJson, generateWithRetry } from '../src/providers.js'

const schema = z.object({ name: z.string() })

describe('MockProvider', () => {
  it('返回值经 schema 校验', async () => {
    const ok = new MockProvider(() => ({ name: 'x' }))
    expect(await ok.generate({ prompt: 'p', schema, schemaName: 's' })).toEqual({ name: 'x' })
    const bad = new MockProvider(() => ({ wrong: 1 }))
    await expect(bad.generate({ prompt: 'p', schema, schemaName: 's' })).rejects.toThrow()
  })
})

describe('extractJson', () => {
  it('直接解析纯 JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
  })
  it('剥掉代码块围栏与前后缀文本', () => {
    expect(extractJson('好的!\n```json\n{"a":1}\n```\n完毕')).toEqual({ a: 1 })
    expect(extractJson('前缀 {"a":{"b":2}} 后缀')).toEqual({ a: { b: 2 } })
  })
  it('无 JSON 时抛错', () => {
    expect(() => extractJson('没有内容')).toThrow()
  })
})

describe('generateWithRetry', () => {
  it('失败后带错误重试,第二次成功', async () => {
    let calls = 0
    const prompts: string[] = []
    const flaky = new MockProvider((opts) => {
      prompts.push(opts.prompt)
      calls++
      return calls === 1 ? { wrong: 1 } : { name: 'ok' }
    })
    const result = await generateWithRetry(flaky, { prompt: 'base', schema, schemaName: 's' })
    expect(result).toEqual({ name: 'ok' })
    expect(calls).toBe(2)
    expect(prompts[1]).toContain('上一次输出不符合要求')
  })
  it('重试 2 次后仍失败则抛出', async () => {
    let calls = 0
    const broken = new MockProvider(() => { calls++; return { wrong: 1 } })
    await expect(generateWithRetry(broken, { prompt: 'p', schema, schemaName: 's' })).rejects.toThrow()
    expect(calls).toBe(3)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run packages/server/test/providers.test.ts`
Expected: FAIL — `../src/providers.js` 不存在

- [ ] **Step 3: 实现 Provider 层**

`packages/server/src/providers.ts`:
```ts
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
      model: process.env.CODE_QUEST_MODEL ?? 'claude-sonnet-4-20250514',
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
```

注意:`ClaudeCliProvider` / `AnthropicApiProvider` 不写单测(依赖外部进程/网络),由 Task 10 的冒烟脚本人工验证;其余全部走 MockProvider。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run packages/server/test/providers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server
git commit -m "feat(server): pluggable LLM providers (claude-cli/api/mock) with retry"
```

---

### Task 8: server — LevelGenerator 生成管线

**Files:**
- Create: `packages/server/src/generator.ts`
- Test: `packages/server/test/generator.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/server/test/generator.test.ts`(用 MockProvider 跑通「测绘→出题→落盘→事件」,并验证引用 hash 回填与造假引用剔除):
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { LevelGenerator } from '../src/generator.js'
import { MockProvider } from '../src/providers.js'
import { RepoScanner } from '../src/scanner.js'
import { ProjectStore, projectIdFor } from '../src/store.js'
import { makeDataHome, makeFixtureRepo } from './helpers.js'
import type { GenerateOptions } from '../src/providers.js'

const courseDraft = {
  projectName: 'demo',
  tagline: '一段奇妙的源码之旅',
  chapters: [{
    id: 'ch1', title: '初入江湖', intro: '了解项目全貌',
    levels: [{ id: 'lv-auth', title: '登录大门', goal: '读懂 login 函数', files: ['src/auth.js', 'ghost.js'] }],
  }],
}

const levelDraft = {
  title: '登录大门', summary: '走进 login 的世界',
  tasks: [
    {
      id: 't1', type: 'quiz', narrative: '勇者你好!', question: 'login 失败时会怎样?',
      options: ['抛出异常', '返回 null'], answer: [0], explanation: '没有 user 会 throw',
      refs: [{ file: 'src/auth.js', startLine: 1, endLine: 4, contentHash: '' }],
    },
    {
      id: 't2', type: 'treasure-hunt', narrative: '寻宝时间!', instruction: '找到 token 函数', hint: '在下半部分',
      explanation: 'token 负责签发', target: { file: 'src/auth.js', startLine: 6, endLine: 8, contentHash: '' },
    },
    {
      id: 't3', type: 'quiz', narrative: '幽灵题', question: 'q?', options: ['a', 'b'], answer: [0],
      explanation: 'e', refs: [{ file: 'ghost.js', startLine: 1, endLine: 2, contentHash: '' }],
    },
  ],
}

function mockProvider() {
  return new MockProvider((opts: GenerateOptions<unknown>) =>
    opts.schemaName === 'course' ? courseDraft : levelDraft,
  )
}

describe('LevelGenerator', () => {
  let repo: string
  beforeEach(async () => {
    await makeDataHome()
    repo = await makeFixtureRepo()
  })

  async function setup() {
    const scanner = await RepoScanner.open(repo)
    const store = new ProjectStore(projectIdFor(repo))
    await store.writeMeta({
      id: store.id, path: repo, name: 'demo', isGit: true,
      anchorCommit: await scanner.head(), createdAt: new Date().toISOString(),
      generation: { status: 'idle' },
    })
    return { scanner, store }
  }

  it('完整生成:课程落盘、关卡落盘、hash 回填、造假引用剔除、事件齐全', async () => {
    const { scanner, store } = await setup()
    const gen = new LevelGenerator(store, scanner, mockProvider())
    const events: string[] = []
    gen.on('event', (e: { type: string }) => events.push(e.type))
    await gen.run()

    const course = (await store.readCourse())!
    // 测绘结果:不存在的 ghost.js 已从 files 中剔除
    expect(course.chapters[0].levels[0].files).toEqual(['src/auth.js'])
    expect(course.chapters[0].levels[0].status).toBe('ready')

    const level = (await store.readLevel('lv-auth'))!
    // 引用 ghost.js 的 t3 被剔除,t1/t2 保留且 hash 已回填
    expect(level.tasks.map((t) => t.id)).toEqual(['t1', 't2'])
    const t1 = level.tasks[0]
    expect(t1.type === 'quiz' && t1.refs[0].contentHash).toMatch(/^[0-9a-f]{16}$/)
    expect(level.files).toEqual(['src/auth.js'])

    expect(events).toContain('course')
    expect(events).toContain('level')
    expect(events).toContain('done')
    expect((await store.readMeta())!.generation.status).toBe('done')
  })

  it('断点续跑:已 ready 的关卡不重新生成', async () => {
    const { scanner, store } = await setup()
    await new LevelGenerator(store, scanner, mockProvider()).run()

    let calls = 0
    const counting = new MockProvider(() => { calls++; return levelDraft })
    await new LevelGenerator(store, scanner, counting).run()
    expect(calls).toBe(0) // 课程已存在 + 关卡已 ready,无需任何 LLM 调用
  })

  it('单关生成失败不阻塞整体,状态标记 failed', async () => {
    const { scanner, store } = await setup()
    const broken = new MockProvider((opts: GenerateOptions<unknown>) => {
      if (opts.schemaName === 'course') return courseDraft
      throw new Error('boom')
    })
    const gen = new LevelGenerator(store, scanner, broken)
    await gen.run()
    const course = (await store.readCourse())!
    expect(course.chapters[0].levels[0].status).toBe('failed')
    expect((await store.readMeta())!.generation.status).toBe('done')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run packages/server/test/generator.test.ts`
Expected: FAIL — `../src/generator.js` 不存在

- [ ] **Step 3: 实现 LevelGenerator**

`packages/server/src/generator.ts`:
```ts
import { EventEmitter } from 'node:events'
import { z } from 'zod'
import {
  TaskSchema,
  type Course,
  type Chapter,
  type CodeRef,
  type Level,
  type LevelOutline,
  type Task,
} from '@code-quest/shared'
import { generateWithRetry, type LLMProvider } from './providers.js'
import type { RepoScanner } from './scanner.js'
import type { ProjectStore } from './store.js'

export type GenEvent =
  | { type: 'course' }
  | { type: 'level'; levelId: string }
  | { type: 'level-failed'; levelId: string; error: string }
  | { type: 'done' }
  | { type: 'error'; error: string }

/** 测绘阶段输出(无 status,由系统补) */
const CourseDraftSchema = z.object({
  projectName: z.string().min(1),
  tagline: z.string().min(1),
  chapters: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        intro: z.string().min(1),
        levels: z
          .array(
            z.object({
              id: z.string().min(1),
              title: z.string().min(1),
              goal: z.string().min(1),
              files: z.array(z.string()).max(4),
            }),
          )
          .min(1)
          .max(4),
      }),
    )
    .min(1)
    .max(6),
})

/** 出题阶段输出(contentHash 允许为空,由系统回填) */
const LevelDraftSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  tasks: z.array(TaskSchema).min(2).max(8),
})

const MAX_TREE_LINES = 400
const MAX_FILE_CHARS = 8000
const MAX_README_CHARS = 2000

export class LevelGenerator extends EventEmitter {
  constructor(
    private store: ProjectStore,
    private scanner: RepoScanner,
    private provider: LLMProvider,
  ) {
    super()
  }

  private emitEvent(e: GenEvent): void {
    this.emit('event', e)
  }

  async run(): Promise<void> {
    const meta = (await this.store.readMeta())!
    try {
      let course = await this.store.readCourse()
      if (!course) {
        await this.store.writeMeta({ ...meta, generation: { status: 'mapping' } })
        course = await this.mapCourse(meta.name)
        await this.store.writeCourse(course)
      }
      this.emitEvent({ type: 'course' })

      await this.store.writeMeta({ ...meta, generation: { status: 'generating' } })
      for (const chapter of course.chapters) {
        for (const outline of chapter.levels) {
          if (outline.status === 'ready') continue
          outline.status = 'generating'
          await this.store.writeCourse(course)
          try {
            const level = await this.generateLevel(chapter, outline)
            await this.store.writeLevel(level)
            outline.status = 'ready'
            this.emitEvent({ type: 'level', levelId: outline.id })
          } catch (err) {
            outline.status = 'failed'
            this.emitEvent({ type: 'level-failed', levelId: outline.id, error: String(err) })
          }
          await this.store.writeCourse(course)
        }
      }
      await this.store.writeMeta({ ...meta, generation: { status: 'done' } })
      this.emitEvent({ type: 'done' })
    } catch (err) {
      await this.store.writeMeta({ ...meta, generation: { status: 'error', error: String(err) } })
      this.emitEvent({ type: 'error', error: String(err) })
    }
  }

  /** 测绘:产出课程大纲,过滤不存在的文件 */
  private async mapCourse(name: string): Promise<Course> {
    const tree = await this.scanner.fileTree()
    const readme = await this.scanner.readFile('README.md').catch(() => '(无 README)')
    const prompt = `你是「源码闯关游戏」的关卡设计师。分析下面的代码仓库,产出一份循序渐进的闯关课程大纲,帮助读者从零理解这个项目。

仓库名称: ${name}

文件清单:
${tree.slice(0, MAX_TREE_LINES).join('\n')}

README 摘录:
${readme.slice(0, MAX_README_CHARS)}

要求:
- 章节主题依次递进: 1) 项目定位与全景 2) 架构与核心抽象 3) 主要业务流程 4) 设计决策与模式。小项目可合并为 2~4 章,大项目最多 6 章。
- 每章 1~4 个关卡,每关聚焦一个主题,goal 写清这一关要让读者学会什么。
- 每关的 files 列出读者需要阅读的 1~4 个文件,必须出自上面的文件清单,逐字一致。
- id 用 kebab-case(如 "ch1-overview"、"lv-entry-point"),全局唯一。
- title/intro/goal/tagline 用中文,带一点复古 RPG 游戏风格的趣味,但内容必须务实。`

    const draft = await generateWithRetry(this.provider, {
      prompt,
      schema: CourseDraftSchema,
      schemaName: 'course',
      cwd: this.scanner.root,
    })
    const known = new Set(tree)
    const chapters: Chapter[] = draft.chapters.map((ch) => ({
      ...ch,
      levels: ch.levels.map(
        (lv): LevelOutline => ({ ...lv, files: lv.files.filter((f) => known.has(f)), status: 'pending' }),
      ),
    }))
    return { projectName: draft.projectName, tagline: draft.tagline, chapters }
  }

  /** 出题:生成单关任务,校验并回填代码引用 */
  private async generateLevel(chapter: Chapter, outline: LevelOutline): Promise<Level> {
    const blocks: string[] = []
    for (const file of outline.files) {
      const content = await this.scanner.readFile(file).catch(() => null)
      if (content === null) continue
      const numbered = content
        .slice(0, MAX_FILE_CHARS)
        .split('\n')
        .map((l, i) => `${i + 1}| ${l}`)
        .join('\n')
      blocks.push(`=== ${file} ===\n${numbered}`)
    }

    const prompt = `你是「源码闯关游戏」的出题人。为下面的关卡设计 3~6 个互动任务,引导读者真正读懂代码。

关卡: ${outline.title}(所属章节: ${chapter.title})
学习目标: ${outline.goal}

相关源码(格式为 行号| 内容):
${blocks.join('\n\n')}

可用任务类型(混合使用,至少包含两种):
- quiz: narrative 用 1~2 段剧情/向导口吻讲解背景,question + options(2~4 个)+ answer(正确选项下标数组,单选时长度为 1)+ explanation。refs 给出本题相关代码位置。
- treasure-hunt: 让读者在代码浏览器中找到并点击某段代码。target 必须是上面源码中的真实位置,instruction 描述要找什么,hint 给提示。
- call-chain: items 给出 3~6 个执行步骤(label 描述 + 可选 ref),order 是 items 的正确顺序下标排列。必须描述代码中真实的调用/执行顺序。
- code-fill: ref 选一段 3~15 行的代码,blankLines 挖掉其中 1~3 行(绝对行号,须在 ref 范围内),answers 按 blankLines 顺序给出被挖行的原文。
- code-type: ref 选一段最能代表本关精髓的 5~15 行代码让读者临摹。

规则:
- 所有 ref/target 的 file 必须出自上面给出的文件;startLine/endLine 必须与源码行号一致;contentHash 一律填空字符串 ""。
- 每个任务的 id 用 kebab-case 且本关内唯一。
- narrative/question/explanation 用中文,语气像复古 RPG 的 NPC 向导,寓教于乐,但技术内容必须准确。
- explanation 要讲清「为什么这样设计」,指向架构理解,不是复述代码。`

    const draft = await generateWithRetry(this.provider, {
      prompt,
      schema: LevelDraftSchema,
      schemaName: 'level',
      cwd: this.scanner.root,
    })

    const tasks: Task[] = []
    for (const task of draft.tasks) {
      const verified = await this.verifyTask(task)
      if (verified) tasks.push(verified)
    }
    if (tasks.length < 1) throw new Error(`关卡 ${outline.id} 没有任何引用合法的任务`)

    const files = [...new Set(tasks.flatMap(taskRefs).map((r) => r.file))]
    return {
      id: outline.id,
      chapterId: chapter.id,
      title: draft.title,
      summary: draft.summary,
      files,
      status: 'ready',
      tasks,
    }
  }

  /** 校验任务的全部代码引用真实存在,并回填 contentHash;非法返回 null */
  private async verifyTask(task: Task): Promise<Task | null> {
    const clone: Task = structuredClone(task)
    for (const ref of taskRefs(clone)) {
      const got = await this.scanner.readRef(ref)
      if (!got.actualHash) return null
      ref.contentHash = got.actualHash
    }
    if (clone.type === 'code-fill') {
      const ok = clone.blankLines.every((l) => l >= clone.ref.startLine && l <= clone.ref.endLine)
      if (!ok) return null
    }
    return clone
  }
}

/** 收集一个任务的全部代码引用(可写引用,用于回填 hash) */
export function taskRefs(task: Task): CodeRef[] {
  switch (task.type) {
    case 'quiz':
      return task.refs
    case 'treasure-hunt':
      return [task.target]
    case 'call-chain':
      return task.items.flatMap((i) => (i.ref ? [i.ref] : []))
    case 'code-fill':
    case 'code-type':
      return [task.ref]
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run packages/server/test/generator.test.ts`
Expected: PASS(3 个用例)

- [ ] **Step 5: Commit**

```bash
git add packages/server
git commit -m "feat(server): level generation pipeline with ref verification and resume"
```

---

### Task 9: server — Fastify HTTP API + SSE

**Files:**
- Create: `packages/server/src/app.ts`
- Test: `packages/server/test/app.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/server/test/app.test.ts`(复用 Task 8 测试中的 mock 数据形状,通过 `app.inject` 走完「导入→等生成完→读关卡→读源码→提交进度」):
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { MockProvider, type GenerateOptions } from '../src/providers.js'
import { makeDataHome, makeFixtureRepo } from './helpers.js'

const courseDraft = {
  projectName: 'demo',
  tagline: '一段奇妙的源码之旅',
  chapters: [{
    id: 'ch1', title: '初入江湖', intro: '了解项目全貌',
    levels: [{ id: 'lv-auth', title: '登录大门', goal: '读懂 login', files: ['src/auth.js'] }],
  }],
}
const levelDraft = {
  title: '登录大门', summary: 's',
  tasks: [{
    id: 't1', type: 'quiz', narrative: 'n', question: 'q', options: ['a', 'b'], answer: [0],
    explanation: 'e', refs: [{ file: 'src/auth.js', startLine: 1, endLine: 4, contentHash: '' }],
  }, {
    id: 't2', type: 'code-type', narrative: 'n', explanation: 'e',
    ref: { file: 'src/auth.js', startLine: 6, endLine: 8, contentHash: '' },
  }],
}

async function waitForDone(app: Awaited<ReturnType<typeof buildApp>>, id: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const res = await app.inject({ method: 'GET', url: `/api/projects/${id}` })
    if (res.json().meta.generation.status === 'done') return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('生成超时')
}

describe('HTTP API', () => {
  let repo: string
  beforeEach(async () => {
    await makeDataHome()
    repo = await makeFixtureRepo()
  })

  function app() {
    return buildApp({
      provider: new MockProvider((opts: GenerateOptions<unknown>) =>
        opts.schemaName === 'course' ? courseDraft : levelDraft,
      ),
    })
  }

  it('导入不存在的路径返回 400', async () => {
    const a = await app()
    const res = await a.inject({ method: 'POST', url: '/api/projects', payload: { path: '/no/such' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('不是有效目录')
  })

  it('导入 → 自动生成 → 读课程与关卡 → 读源码 → 提交通关', async () => {
    const a = await app()
    const imported = await a.inject({ method: 'POST', url: '/api/projects', payload: { path: repo } })
    expect(imported.statusCode).toBe(200)
    const { id } = imported.json()
    await waitForDone(a, id)

    const project = (await a.inject({ method: 'GET', url: `/api/projects/${id}` })).json()
    expect(project.course.chapters[0].levels[0].status).toBe('ready')
    expect(project.progress.xp).toBe(0)

    const levelRes = (await a.inject({ method: 'GET', url: `/api/projects/${id}/levels/lv-auth` })).json()
    expect(levelRes.level.tasks).toHaveLength(2)
    expect(levelRes.freshness.t1).toBe(true)

    const file = (await a.inject({
      method: 'GET', url: `/api/projects/${id}/file?path=${encodeURIComponent('src/auth.js')}`,
    })).json()
    expect(file.content).toContain('function login')

    const done = (await a.inject({
      method: 'POST', url: `/api/projects/${id}/progress/level`,
      payload: { levelId: 'lv-auth', result: { rating: 'S', accuracy: 1, maxCombo: 2, xp: 35 }, taskCount: 2 },
    })).json()
    expect(done.progress.xp).toBe(35)
    expect(done.newBadges).toContain('first-level')

    const read = (await a.inject({
      method: 'POST', url: `/api/projects/${id}/progress/file-read`, payload: { file: 'src/auth.js' },
    })).json()
    expect(read.progress.filesRead).toContain('src/auth.js')
  })

  it('重复导入同一路径复用同一项目', async () => {
    const a = await app()
    const r1 = (await a.inject({ method: 'POST', url: '/api/projects', payload: { path: repo } })).json()
    await waitForDone(a, r1.id)
    const r2 = (await a.inject({ method: 'POST', url: '/api/projects', payload: { path: repo } })).json()
    expect(r2.id).toBe(r1.id)
    const list = (await a.inject({ method: 'GET', url: '/api/projects' })).json()
    expect(list.projects).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run packages/server/test/app.test.ts`
Expected: FAIL — `../src/app.js` 不存在

- [ ] **Step 3: 实现 app**

`packages/server/src/app.ts`:
```ts
import path from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  LevelResultSchema,
  applyLevelResult,
  emptyProgress,
  type Progress,
} from '@code-quest/shared'
import { LevelGenerator, taskRefs, type GenEvent } from './generator.js'
import { detectProvider, type LLMProvider } from './providers.js'
import { RepoScanner } from './scanner.js'
import { ProjectStore, projectIdFor } from './store.js'

export interface AppOptions {
  /** 测试注入;缺省时首次导入懒探测 claude CLI / API key */
  provider?: LLMProvider
}

const ImportBodySchema = z.object({ path: z.string().min(1) })
const LevelDoneBodySchema = z.object({
  levelId: z.string().min(1),
  result: LevelResultSchema,
  taskCount: z.number().int().positive(),
})
const FileReadBodySchema = z.object({ file: z.string().min(1) })

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  let provider = opts.provider ?? null
  /** projectId → 运行中的生成器(SSE 订阅 + 防重复启动) */
  const generators = new Map<string, LevelGenerator>()

  async function getProvider(): Promise<LLMProvider> {
    if (!provider) provider = await detectProvider()
    return provider
  }

  async function startGeneration(store: ProjectStore, scanner: RepoScanner): Promise<void> {
    if (generators.has(store.id)) return
    const gen = new LevelGenerator(store, scanner, await getProvider())
    generators.set(store.id, gen)
    void gen.run().finally(() => generators.delete(store.id))
  }

  // 导入项目(已存在则复用并按需续跑生成)
  app.post('/api/projects', async (req, reply) => {
    const body = ImportBodySchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: '缺少 path 参数' })
    let scanner: RepoScanner
    try {
      scanner = await RepoScanner.open(body.data.path)
    } catch (err) {
      return reply.code(400).send({ error: String((err as Error).message) })
    }
    const id = projectIdFor(scanner.root)
    const store = new ProjectStore(id)
    let meta = await store.readMeta()
    if (!meta) {
      meta = {
        id,
        path: scanner.root,
        name: path.basename(scanner.root),
        isGit: scanner.isGit,
        anchorCommit: await scanner.head(),
        createdAt: new Date().toISOString(),
        generation: { status: 'idle' },
      }
      await store.writeMeta(meta)
      await store.writeProgress(emptyProgress())
    }
    if (meta.generation.status !== 'done') await startGeneration(store, scanner)
    return { id, name: meta.name }
  })

  app.get('/api/projects', async () => ({ projects: await ProjectStore.list() }))

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const store = new ProjectStore(req.params.id)
    const meta = await store.readMeta()
    if (!meta) return reply.code(404).send({ error: '项目不存在' })
    return {
      meta,
      course: await store.readCourse(),
      progress: (await store.readProgress()) ?? emptyProgress(),
    }
  })

  // 重试/继续生成
  app.post<{ Params: { id: string } }>('/api/projects/:id/generate', async (req, reply) => {
    const store = new ProjectStore(req.params.id)
    const meta = await store.readMeta()
    if (!meta) return reply.code(404).send({ error: '项目不存在' })
    const scanner = await RepoScanner.open(meta.path)
    // 把 failed 的关卡重置为 pending 以便重试
    const course = await store.readCourse()
    if (course) {
      for (const ch of course.chapters)
        for (const lv of ch.levels) if (lv.status === 'failed') lv.status = 'pending'
      await store.writeCourse(course)
    }
    await startGeneration(store, scanner)
    return { ok: true }
  })

  // 生成进度 SSE
  app.get<{ Params: { id: string } }>('/api/projects/:id/events', async (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    const gen = generators.get(req.params.id)
    if (!gen) {
      reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
      reply.raw.end()
      return reply
    }
    const close = () => {
      gen.off('event', onEvent)
      reply.raw.end()
    }
    const onEvent = (e: GenEvent) => {
      reply.raw.write(`data: ${JSON.stringify(e)}\n\n`)
      if (e.type === 'done' || e.type === 'error') close()
    }
    gen.on('event', onEvent)
    req.raw.on('close', close)
    return reply
  })

  // 读取关卡 + 引用新鲜度
  app.get<{ Params: { id: string; levelId: string } }>(
    '/api/projects/:id/levels/:levelId',
    async (req, reply) => {
      const store = new ProjectStore(req.params.id)
      const meta = await store.readMeta()
      if (!meta) return reply.code(404).send({ error: '项目不存在' })
      const level = await store.readLevel(req.params.levelId)
      if (!level) return reply.code(404).send({ error: '关卡不存在' })
      const scanner = await RepoScanner.open(meta.path)
      const freshness: Record<string, boolean> = {}
      for (const task of level.tasks) {
        const checks = await Promise.all(taskRefs(task).map((r) => scanner.readRef(r)))
        freshness[task.id] = checks.every((c) => c.fresh)
      }
      return { level, freshness }
    },
  )

  // 读取源码文件
  app.get<{ Params: { id: string }; Querystring: { path?: string } }>(
    '/api/projects/:id/file',
    async (req, reply) => {
      const store = new ProjectStore(req.params.id)
      const meta = await store.readMeta()
      if (!meta) return reply.code(404).send({ error: '项目不存在' })
      if (!req.query.path) return reply.code(400).send({ error: '缺少 path 参数' })
      const scanner = await RepoScanner.open(meta.path)
      try {
        return { content: await scanner.readFile(req.query.path) }
      } catch {
        return reply.code(404).send({ error: '文件不存在' })
      }
    },
  )

  // 文件树(前端文件浏览器用)
  app.get<{ Params: { id: string } }>('/api/projects/:id/tree', async (req, reply) => {
    const store = new ProjectStore(req.params.id)
    const meta = await store.readMeta()
    if (!meta) return reply.code(404).send({ error: '项目不存在' })
    const scanner = await RepoScanner.open(meta.path)
    return { files: await scanner.fileTree() }
  })

  // 提交通关结果
  app.post<{ Params: { id: string } }>('/api/projects/:id/progress/level', async (req, reply) => {
    const body = LevelDoneBodySchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: body.error.message })
    const store = new ProjectStore(req.params.id)
    const course = await store.readCourse()
    if (!course) return reply.code(404).send({ error: '课程不存在' })
    const progress: Progress = (await store.readProgress()) ?? emptyProgress()
    const { progress: next, newBadges } = applyLevelResult(progress, course, body.data)
    await store.writeProgress(next)
    return { progress: next, newBadges }
  })

  // 记录文件阅读(考古学家徽章用)
  app.post<{ Params: { id: string } }>('/api/projects/:id/progress/file-read', async (req, reply) => {
    const body = FileReadBodySchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: body.error.message })
    const store = new ProjectStore(req.params.id)
    const progress: Progress = (await store.readProgress()) ?? emptyProgress()
    if (!progress.filesRead.includes(body.data.file)) {
      progress.filesRead = [...progress.filesRead, body.data.file]
      await store.writeProgress(progress)
    }
    return { progress }
  })

  return app
}
```

同时在 `packages/server/src/providers.ts` 确认 `GenerateOptions` 已 export(Task 7 已做)。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run packages/server/test/app.test.ts`
Expected: PASS(3 个用例)

- [ ] **Step 5: 跑全部测试 + Commit**

Run: `npx vitest run`
Expected: 全部 PASS

```bash
git add packages/server
git commit -m "feat(server): HTTP API with import/generate/levels/progress + SSE"
```

---

### Task 10: server — CLI 启动入口 + 冒烟脚本

**Files:**
- Create: `packages/server/src/cli.ts`
- Create: `packages/server/scripts/smoke.ts`

- [ ] **Step 1: 实现 CLI 入口**

`packages/server/src/cli.ts`:
```ts
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
```

- [ ] **Step 2: 实现真实 LLM 冒烟脚本(不进 CI)**

`packages/server/scripts/smoke.ts`:
```ts
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
```

- [ ] **Step 3: 手动验证启动**

Run: `npm run dev -w @code-quest/server -- --no-open`(在仓库根目录;验证后 Ctrl+C)
Expected: 输出 `🎮 CodeQuest 已启动: http://localhost:4977`,且 `curl http://localhost:4977/api/projects` 返回 `{"projects":[]}`

- [ ] **Step 4: 跑全部测试 + Commit**

Run: `npx vitest run`
Expected: 全部 PASS

```bash
git add packages/server
git commit -m "feat(server): cli entry and llm smoke script"
```

---

## 完成标准(计划 1)

- `npx vitest run` 全绿
- `npm run dev -- --no-open` 可启动,curl 走通「导入 → 生成(真实或 Mock)→ 读关卡 → 提交进度」
- 后续:计划 2(游戏前端)、计划 3(增量更新 + 证书)在本计划完成后另行编写

