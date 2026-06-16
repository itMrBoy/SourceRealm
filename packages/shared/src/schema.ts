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

export const CallChainTaskSchema = z.object({
  ...taskBase,
  type: z.literal('call-chain'),
  items: z.array(z.object({ label: z.string().min(1), ref: CodeRefSchema.optional() })).min(3).max(6),
  order: z.array(z.number().int().nonnegative()),
})

export const CodeFillTaskSchema = z.object({
  ...taskBase,
  type: z.literal('code-fill'),
  ref: CodeRefSchema,
  blankLines: z.array(z.number().int().positive()).min(1).max(3),
  answers: z.array(z.string().min(1)),
})

export const CodeTypeTaskSchema = z.object({
  ...taskBase,
  type: z.literal('code-type'),
  ref: CodeRefSchema,
})

export const TaskSchema = z
  .discriminatedUnion('type', [
    QuizTaskSchema,
    TreasureHuntTaskSchema,
    CallChainTaskSchema,
    CodeFillTaskSchema,
    CodeTypeTaskSchema,
  ])
  // Zod v3 的 discriminatedUnion 不接受 .refine() 过的成员,跨字段校验只能上提到这里
  .superRefine((t, ctx) => {
    if (t.type === 'call-chain') {
      if (t.order.length !== t.items.length || new Set(t.order).size !== t.items.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'order 必须是 items 下标的一个排列', path: ['order'] })
      }
    }
    if (t.type === 'code-fill' && t.blankLines.length !== t.answers.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'answers 与 blankLines 数量一致', path: ['answers'] })
    }
  })
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

export const SavedAnswerSchema = z.object({
  taskIndex: z.number().int().nonnegative(),
  taskId: z.string().min(1),
  correct: z.boolean(),
  explanation: z.string(),
})
export type SavedAnswer = z.infer<typeof SavedAnswerSchema>

export const LevelResultSchema = z.object({
  rating: RatingSchema,
  accuracy: z.number().min(0).max(1),
  maxCombo: z.number().int().nonnegative(),
  xp: z.number().int().nonnegative(),
  // 通关后用于只读回顾的逐题作答记录;旧存档可能缺省(向后兼容)
  answeredHistory: z.array(SavedAnswerSchema).optional(),
})
export type LevelResult = z.infer<typeof LevelResultSchema>

export const SavedRunPhaseSchema = z.enum(['narrative', 'answering', 'feedback', 'failed'])
export type SavedRunPhase = z.infer<typeof SavedRunPhaseSchema>

export const SavedRunSchema = z.object({
  levelId: z.string().min(1),
  taskIndex: z.number().int().nonnegative(),
  hearts: z.number().int().nonnegative(),
  combo: z.number().int().nonnegative(),
  maxCombo: z.number().int().nonnegative(),
  xpEarned: z.number().int().nonnegative(),
  wrongAnswers: z.number().int().nonnegative(),
  totalAnswers: z.number().int().nonnegative(),
  scoredTaskCount: z.number().int().nonnegative(),
  phase: SavedRunPhaseSchema,
  lastCorrect: z.boolean().nullable(),
  answeredHistory: z.array(SavedAnswerSchema),
  updatedAt: z.string(),
})
export type SavedRun = z.infer<typeof SavedRunSchema>

export const ProgressSchema = z.object({
  xp: z.number().int().nonnegative(),
  completedLevels: z.record(z.string(), LevelResultSchema),
  badges: z.array(z.string()),
  filesRead: z.array(z.string()),
  levelRuns: z.record(z.string(), SavedRunSchema).default({}),
})
export type Progress = z.output<typeof ProgressSchema>

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
