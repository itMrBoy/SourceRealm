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
