import { EventEmitter } from 'node:events'
import { execa } from 'execa'
import { z } from 'zod'
import type { Chapter, Course, Level, LevelOutline } from '@code-quest/shared'
import { LevelGenerator, LevelDraftSchema, taskRefs } from './generator.js'
import { generateWithRetry, type LLMProvider } from './providers.js'
import type { RepoScanner } from './scanner.js'
import type { ProjectStore } from './store.js'

export interface RepoDiff {
  modified: string[]
  deleted: string[]
  added: string[]
}

/**
 * 计算 anchor..HEAD 的文件级变更集。
 * 解析 git diff --name-status:
 *   M / T → modified
 *   A / C → added(C 取新路径)
 *   D     → deleted
 *   R     → 旧路径 deleted + 新路径 added
 */
export async function diffSince(scanner: RepoScanner, anchor: string): Promise<RepoDiff> {
  const { stdout } = await execa(
    'git',
    ['diff', '--name-status', '--find-renames', `${anchor}..HEAD`],
    { cwd: scanner.root },
  )
  const diff: RepoDiff = { modified: [], deleted: [], added: [] }
  if (!stdout) return diff

  for (const line of stdout.split('\n')) {
    if (!line) continue
    const parts = line.split('\t')
    const status = parts[0]
    const code = status[0]
    switch (code) {
      case 'M':
      case 'T':
        if (parts[1]) diff.modified.push(parts[1])
        break
      case 'A':
        if (parts[1]) diff.added.push(parts[1])
        break
      case 'D':
        if (parts[1]) diff.deleted.push(parts[1])
        break
      case 'C':
        // copy:新路径是最后一段
        if (parts[2]) diff.added.push(parts[2])
        else if (parts[1]) diff.added.push(parts[1])
        break
      case 'R':
        // rename:R<score>\t<old>\t<new>
        if (parts[1]) diff.deleted.push(parts[1])
        if (parts[2]) diff.added.push(parts[2])
        break
      default:
        break
    }
  }
  return diff
}

export interface ImpactResult {
  staleLevels: string[]
  obsoleteLevels: string[]
  needsNewLevels: boolean
}

export const NEW_FILES_THRESHOLD = 3

/**
 * 纯函数:基于关卡引用文件与 diff 计算影响。
 * - 引用文件全部被删 → obsolete
 * - 否则任一引用文件被删或被改 → stale
 * - 新增文件数 ≥ 阈值 → needsNewLevels
 */
export function analyzeImpact(levelFiles: Map<string, string[]>, diff: RepoDiff): ImpactResult {
  const deleted = new Set(diff.deleted)
  const modified = new Set(diff.modified)
  const staleLevels: string[] = []
  const obsoleteLevels: string[] = []

  for (const [levelId, refs] of levelFiles) {
    if (refs.length > 0 && refs.every((r) => deleted.has(r))) {
      obsoleteLevels.push(levelId)
    } else if (refs.some((r) => deleted.has(r) || modified.has(r))) {
      staleLevels.push(levelId)
    }
  }

  return {
    staleLevels,
    obsoleteLevels,
    needsNewLevels: diff.added.length >= NEW_FILES_THRESHOLD,
  }
}

export interface CheckResult {
  changed: boolean
  anchor: string | null
  head: string | null
  summary?: { modified: number; deleted: number; added: number }
}

/**
 * 检测自 anchorCommit 以来是否有需要处理的变更。
 * 独立函数:只需 store + scanner,不依赖 LLM provider(check 不出题)。
 */
export async function checkForUpdates(
  store: ProjectStore,
  scanner: RepoScanner,
): Promise<CheckResult> {
  const meta = await store.readMeta()
  const anchor = meta?.anchorCommit ?? null
  const head = await scanner.head()
  if (!anchor || !head || anchor === head) {
    return { changed: false, anchor, head }
  }
  const diff = await diffSince(scanner, anchor)
  const summary = {
    modified: diff.modified.length,
    deleted: diff.deleted.length,
    added: diff.added.length,
  }
  const changed = summary.modified > 0 || summary.deleted > 0 || summary.added > 0
  return { changed, anchor, head, summary }
}

// ─── CourseUpdater(增量更新管线)────────────────────────────────────────────

export type UpdateEvent =
  | { type: 'update-start'; staleCount: number; obsoleteCount: number; appending: boolean }
  | { type: 'level'; levelId: string }
  | { type: 'level-failed'; levelId: string; error: string }
  | { type: 'done' }
  | { type: 'error'; error: string }

const MAX_FILE_CHARS = 8000
const MAX_DIFF_CHARS = 4000

/** 追加测绘输出:只允许追加,挂到已有章节(attachTo)或新增章节 */
const AppendDraftSchema = z.object({
  chapters: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        intro: z.string().min(1),
        /** 如要把这些关卡挂到已有章节,给出已有 chapter id;否则新建章节 */
        attachTo: z.string().optional(),
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
    .max(2),
})

/**
 * 增量更新管线:基于 git diff 修订受影响关卡、作废删除关卡、按需追加新关卡,
 * 全部成功后原子切换 anchorCommit。progress.json 永不触碰。
 */
export class CourseUpdater extends EventEmitter {
  constructor(
    private store: ProjectStore,
    private scanner: RepoScanner,
    private provider: LLMProvider,
  ) {
    super()
  }

  private emitEvent(e: UpdateEvent): void {
    this.emit('event', e)
  }

  /** 检测自 anchorCommit 以来是否有需要处理的变更(委托独立函数,保留方法以兼容) */
  async check(): Promise<CheckResult> {
    return checkForUpdates(this.store, this.scanner)
  }

  async run(): Promise<void> {
    const meta = (await this.store.readMeta())!
    const course = (await this.store.readCourse())!
    const head = await this.scanner.head()
    // 暂存待写关卡(原子切换前先落到 levels-next/)
    const pending: Level[] = []
    try {
      await this.store.clearNextLevels()
      await this.store.writeMeta({ ...meta, generation: { status: 'generating' } })

      const anchor = meta.anchorCommit!
      const diff = await diffSince(this.scanner, anchor)

      // 读取每个 outline 的引用文件(优先 level JSON 的 files,缺失时用 outline.files)
      const levelFiles = new Map<string, string[]>()
      const outlineById = new Map<string, LevelOutline>()
      const chapterByOutline = new Map<string, Chapter>()
      for (const chapter of course.chapters) {
        for (const outline of chapter.levels) {
          outlineById.set(outline.id, outline)
          chapterByOutline.set(outline.id, chapter)
          const level = await this.store.readLevel(outline.id)
          levelFiles.set(outline.id, level?.files ?? outline.files)
        }
      }

      const impact = analyzeImpact(levelFiles, diff)

      this.emitEvent({
        type: 'update-start',
        staleCount: impact.staleLevels.length,
        obsoleteCount: impact.obsoleteLevels.length,
        appending: impact.needsNewLevels,
      })

      // a. 作废删除关卡:level JSON status='obsolete' + outline 同步
      for (const id of impact.obsoleteLevels) {
        const level = await this.store.readLevel(id)
        if (level) pending.push({ ...level, status: 'obsolete' })
        const outline = outlineById.get(id)
        if (outline) outline.status = 'obsolete'
      }

      // b. 修订受影响关卡
      for (const id of impact.staleLevels) {
        const outline = outlineById.get(id)
        const chapter = chapterByOutline.get(id)
        if (!outline || !chapter) continue
        try {
          const revised = await this.reviseLevel(chapter, outline, levelFiles.get(id) ?? outline.files, anchor)
          pending.push(revised)
          outline.status = 'ready'
          outline.files = revised.files
          this.emitEvent({ type: 'level', levelId: id })
        } catch (err) {
          // 修订失败:保留旧版(可玩),outline 标 stale 供前端提示「!」并可手动重生成恢复
          outline.status = 'stale'
          this.emitEvent({ type: 'level-failed', levelId: id, error: String(err) })
        }
      }

      // c. 追加新关卡
      if (impact.needsNewLevels) {
        await this.appendLevels(course, diff, pending)
      }

      // d. 原子切换:先把 pending 写入 levels-next/,再整体提升
      for (const level of pending) {
        await this.store.writeLevelNext(level)
      }
      await this.store.promoteNextLevels()
      await this.store.writeCourse(course)
      await this.store.writeMeta({
        ...meta,
        anchorCommit: head,
        generation: { status: 'done' },
      })
      this.emitEvent({ type: 'done' })
    } catch (err) {
      await this.store.clearNextLevels()
      await this.store.writeMeta({
        ...meta,
        generation: { status: 'error', error: String(err) },
      })
      this.emitEvent({ type: 'error', error: String(err) })
    }
  }

  /** LLM 修订一关:输入旧关卡 + 受影响文件新内容 + diff,要求最小改动 */
  private async reviseLevel(
    chapter: Chapter,
    outline: LevelOutline,
    files: string[],
    anchor: string,
  ): Promise<Level> {
    const oldLevel = await this.store.readLevel(outline.id)

    const fileBlocks: string[] = []
    for (const file of files) {
      const content = await this.scanner.readFile(file).catch(() => null)
      if (content === null) {
        fileBlocks.push(`=== ${file} ===\n(文件已删除)`)
        continue
      }
      const numbered = content
        .slice(0, MAX_FILE_CHARS)
        .split('\n')
        .map((l, i) => `${i + 1}| ${l}`)
        .join('\n')
      fileBlocks.push(`=== ${file} ===\n${numbered}`)
    }

    let diffText = ''
    try {
      const { stdout } = await execa(
        'git',
        ['diff', `${anchor}..HEAD`, '--', ...files],
        { cwd: this.scanner.root },
      )
      diffText = stdout.slice(0, MAX_DIFF_CHARS)
    } catch {
      diffText = ''
    }

    const prompt = `你是「源码闯关游戏」的关卡维护者。下面这一关引用的源码发生了变化,请做「最小改动」的修订。

旧关卡 JSON:
${JSON.stringify(oldLevel ?? { title: outline.title, summary: outline.goal, tasks: [] }, null, 2)}

受影响文件的新版内容(格式为 行号| 内容):
${fileBlocks.join('\n\n')}

相关 git diff:
${diffText || '(无 diff 文本)'}

修订要求:
- 最小改动:仍然有效的任务原样保留,引用行号如有位移请修正。
- 失效的任务(引用的代码已删除或语义已变)替换为基于新代码的等效新任务。
- 所有 ref/target 的 file 必须出自上面给出的文件;startLine/endLine 必须与新源码行号一致;contentHash 一律填空字符串 ""。
- 输出完整关卡(title、summary、tasks),符合 LevelDraftSchema。`

    const draft = await generateWithRetry(this.provider, {
      prompt,
      schema: LevelDraftSchema,
      schemaName: 'level',
      cwd: this.scanner.root,
    })

    const gen = new LevelGenerator(this.store, this.scanner, this.provider)
    const tasks = []
    for (const task of draft.tasks) {
      const verified = await gen.verifyTask(task)
      if (verified) tasks.push(verified)
    }
    if (tasks.length < 1) throw new Error(`关卡 ${outline.id} 修订后没有任何引用合法的任务`)

    const refFiles = [...new Set(tasks.flatMap(taskRefs).map((r) => r.file))]
    return {
      id: outline.id,
      chapterId: chapter.id,
      title: draft.title,
      summary: draft.summary,
      files: refFiles,
      status: 'ready',
      tasks,
    }
  }

  /** 轻量补测绘 + 为新 outline 出题(只允许追加) */
  private async appendLevels(course: Course, diff: RepoDiff, pending: Level[]): Promise<void> {
    const tree = await this.scanner.fileTree()
    const known = new Set(tree)
    const outlineSummary = course.chapters
      .map((ch) => `- ${ch.id} ${ch.title}\n${ch.levels.map((l) => `  · ${l.title}`).join('\n')}`)
      .join('\n')

    const prompt = `你是「源码闯关游戏」的关卡设计师。仓库新增了一些文件,请为它们设计「追加」关卡(只新增,不改动现有关卡)。

现有课程大纲:
${outlineSummary}

新增的文件清单:
${diff.added.join('\n')}

要求:
- 只产出针对新增文件的新关卡;如果新文件属于某个已有章节主题,可用 attachTo 指定该已有 chapter id,否则新建章节。
- 每关的 files 只能出自新增文件清单或已有文件,逐字一致,最多 4 个。
- id 用 kebab-case 且全局唯一(不要与现有 id 冲突)。
- title/intro/goal 用中文,带一点复古 RPG 趣味。`

    const draft = await generateWithRetry(this.provider, {
      prompt,
      schema: AppendDraftSchema,
      schemaName: 'append',
      cwd: this.scanner.root,
    })

    const existingChapterIds = new Set(course.chapters.map((c) => c.id))
    const allowedFiles = new Set([...known, ...diff.added])
    const gen = new LevelGenerator(this.store, this.scanner, this.provider)

    for (const draftCh of draft.chapters) {
      const outlines: LevelOutline[] = draftCh.levels.map((lv) => ({
        ...lv,
        files: lv.files.filter((f) => allowedFiles.has(f)),
        status: 'pending',
      }))

      // 找到挂载目标章节,或新建
      let target: Chapter
      const attach = draftCh.attachTo && existingChapterIds.has(draftCh.attachTo)
        ? course.chapters.find((c) => c.id === draftCh.attachTo)!
        : null
      if (attach) {
        target = attach
      } else {
        target = { id: draftCh.id, title: draftCh.title, intro: draftCh.intro, levels: [] }
        course.chapters.push(target)
      }

      for (const outline of outlines) {
        target.levels.push(outline)
        try {
          const level = await gen.generateLevel(target, outline)
          pending.push(level)
          outline.status = 'ready'
          outline.files = level.files
          this.emitEvent({ type: 'level', levelId: outline.id })
        } catch (err) {
          outline.status = 'failed'
          this.emitEvent({ type: 'level-failed', levelId: outline.id, error: String(err) })
        }
      }
    }
  }
}
