import { create } from 'zustand'
import { rateLevel, taskXp, type Level, type Rating, type SavedAnswer, type SavedRun, type TaskType } from '@sourcerealm/shared'
import * as api from '../api.js'
import { useStore } from '../store.js'

export type RunPhase =
  | 'loading'
  | 'narrative'
  | 'answering'
  | 'feedback'
  | 'level-done'
  | 'settled'
  | 'failed'

const START_HEARTS = 3

export interface Settlement {
  rating: Rating
  accuracy: number
  maxCombo: number
  xp: number
  newBadges: string[]
}

export interface RunState {
  level: Level | null
  freshness: Record<string, boolean>
  taskIndex: number
  hearts: number
  combo: number
  maxCombo: number
  xpEarned: number
  wrongAnswers: number
  totalAnswers: number
  /** 计入计分的任务数(过关的非陈旧任务);陈旧/跳过任务不计入 */
  scoredTaskCount: number
  phase: RunPhase
  lastCorrect: boolean | null
  error: string | null
  /** 已结算:rating + newBadges */
  settlement: Settlement | null
  /** 防止重复提交结算 */
  settling: boolean
  /** 已完成题目的只读回顾记录 */
  answeredHistory: SavedAnswer[]

  loadLevel: (projectId: string, levelId: string) => Promise<void>
  snapshot: () => SavedRun | null
  startAnswering: () => void
  answer: (correct: boolean, taskType: TaskType) => void
  nextTask: () => void
  retryTask: () => void
  retryLevel: () => void
  skipStale: (taskId: string) => void
  finishLevel: (projectId: string) => Promise<void>
  reset: () => void
}

function freshState() {
  return {
    level: null as Level | null,
    freshness: {} as Record<string, boolean>,
    taskIndex: 0,
    hearts: START_HEARTS,
    combo: 0,
    maxCombo: 0,
    xpEarned: 0,
    wrongAnswers: 0,
    totalAnswers: 0,
    scoredTaskCount: 0,
    phase: 'loading' as RunPhase,
    lastCorrect: null as boolean | null,
    error: null as string | null,
    settlement: null as Settlement | null,
    settling: false,
    answeredHistory: [] as SavedAnswer[],
  }
}

function canPersistPhase(phase: RunPhase): phase is SavedRun['phase'] {
  return phase === 'narrative' || phase === 'answering' || phase === 'feedback' || phase === 'failed'
}

export const useRun = create<RunState>((set, get) => ({
  ...freshState(),

  async loadLevel(projectId, levelId) {
    set({ ...freshState(), phase: 'loading' })
    try {
      const { level, freshness } = await api.getLevel(projectId, levelId)
      const saved = useStore.getState().progress.levelRuns?.[levelId]
      if (saved && saved.taskIndex < level.tasks.length) {
        set({
          level,
          freshness,
          taskIndex: saved.taskIndex,
          hearts: saved.hearts,
          combo: saved.combo,
          maxCombo: saved.maxCombo,
          xpEarned: saved.xpEarned,
          wrongAnswers: saved.wrongAnswers,
          totalAnswers: saved.totalAnswers,
          scoredTaskCount: saved.scoredTaskCount,
          phase: saved.phase,
          lastCorrect: saved.lastCorrect,
          answeredHistory: saved.answeredHistory,
        })
      } else {
        set({ level, freshness, phase: 'narrative' })
      }
    } catch (err) {
      set({ phase: 'failed', error: err instanceof Error ? err.message : '关卡加载失败' })
    }
  },

  snapshot() {
    const s = get()
    if (!s.level || !canPersistPhase(s.phase)) return null
    return {
      levelId: s.level.id,
      taskIndex: s.taskIndex,
      hearts: s.hearts,
      combo: s.combo,
      maxCombo: s.maxCombo,
      xpEarned: s.xpEarned,
      wrongAnswers: s.wrongAnswers,
      totalAnswers: s.totalAnswers,
      scoredTaskCount: s.scoredTaskCount,
      phase: s.phase,
      lastCorrect: s.lastCorrect,
      answeredHistory: s.answeredHistory,
      updatedAt: new Date().toISOString(),
    }
  },

  startAnswering() {
    set({ phase: 'answering' })
  },

  answer(correct, taskType) {
    const s = get()
    const task = s.level?.tasks[s.taskIndex]
    if (correct) {
      set({
        xpEarned: s.xpEarned + taskXp(taskType, s.combo),
        combo: s.combo + 1,
        maxCombo: Math.max(s.maxCombo, s.combo + 1),
        totalAnswers: s.totalAnswers + 1,
        scoredTaskCount: s.scoredTaskCount + 1,
        phase: 'feedback',
        lastCorrect: true,
        answeredHistory: task
          ? [
              ...s.answeredHistory.filter((a) => a.taskIndex !== s.taskIndex),
              { taskIndex: s.taskIndex, taskId: task.id, correct: true, explanation: task.explanation },
            ]
          : s.answeredHistory,
      })
    } else {
      const hearts = s.hearts - 1
      set({
        combo: 0,
        hearts,
        wrongAnswers: s.wrongAnswers + 1,
        totalAnswers: s.totalAnswers + 1,
        phase: hearts <= 0 ? 'failed' : 'feedback',
        lastCorrect: false,
        answeredHistory: task
          ? [
              ...s.answeredHistory.filter((a) => a.taskIndex !== s.taskIndex),
              { taskIndex: s.taskIndex, taskId: task.id, correct: false, explanation: task.explanation },
            ]
          : s.answeredHistory,
      })
    }
  },

  nextTask() {
    const s = get()
    if (!s.level) return
    const next = s.taskIndex + 1
    if (next >= s.level.tasks.length) {
      set({ phase: 'level-done', lastCorrect: null })
    } else {
      set({ taskIndex: next, phase: 'narrative', lastCorrect: null })
    }
  },

  retryTask() {
    set({ phase: 'answering', lastCorrect: null })
  },

  retryLevel() {
    set({
      taskIndex: 0,
      hearts: START_HEARTS,
      combo: 0,
      maxCombo: 0,
      xpEarned: 0,
      wrongAnswers: 0,
      totalAnswers: 0,
      scoredTaskCount: 0,
      phase: 'narrative',
      lastCorrect: null,
      settlement: null,
      settling: false,
      answeredHistory: [],
    })
  },

  // 源码已变化的任务:自动通过,不计入计分(对错都不动)
  skipStale(_taskId) {
    get().nextTask()
  },

  // 结算:计算评级、提交进度、记录新徽章。幂等(只提交一次)。
  async finishLevel(projectId) {
    const s = get()
    if (s.settling || s.settlement) return
    if (!s.level) return
    set({ settling: true })
    const accuracy = runAccuracy(s)
    // 全部任务因源码变化被跳过时也要能结算:按 1 题、C 评、0 XP 记通过(后端要求 taskCount >= 1)
    const allSkipped = s.scoredTaskCount === 0
    const taskCount = allSkipped ? 1 : s.scoredTaskCount
    const rating = allSkipped ? 'C' : rateLevel(accuracy, s.maxCombo, s.scoredTaskCount)
    const levelId = s.level.id
    try {
      const { progress, newBadges } = await api.submitLevel(projectId, {
        levelId,
        result: { rating, accuracy, maxCombo: s.maxCombo, xp: allSkipped ? 0 : s.xpEarned },
        taskCount,
      })
      useStore.getState().setProgress(progress)
      set({
        phase: 'settled',
        settling: false,
        settlement: { rating, accuracy, maxCombo: s.maxCombo, xp: allSkipped ? 0 : s.xpEarned, newBadges },
      })
    } catch (err) {
      set({
        phase: 'failed',
        settling: false,
        error: err instanceof Error ? err.message : '结算提交失败',
      })
    }
  },

  reset() {
    set(freshState())
  },
}))

/** accuracy = (totalAnswers - wrongAnswers) / max(1, totalAnswers) */
export function runAccuracy(s: Pick<RunState, 'totalAnswers' | 'wrongAnswers'>): number {
  return (s.totalAnswers - s.wrongAnswers) / Math.max(1, s.totalAnswers)
}
