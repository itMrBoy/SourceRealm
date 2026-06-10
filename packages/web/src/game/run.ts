import { create } from 'zustand'
import { taskXp, type Level, type TaskType } from '@code-quest/shared'
import * as api from '../api.js'

export type RunPhase =
  | 'loading'
  | 'narrative'
  | 'answering'
  | 'feedback'
  | 'level-done'
  | 'failed'

const START_HEARTS = 3

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
  phase: RunPhase
  lastCorrect: boolean | null
  error: string | null

  loadLevel: (projectId: string, levelId: string) => Promise<void>
  startAnswering: () => void
  answer: (correct: boolean, taskType: TaskType) => void
  nextTask: () => void
  retryTask: () => void
  retryLevel: () => void
  skipStale: (taskId: string) => void
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
    phase: 'loading' as RunPhase,
    lastCorrect: null as boolean | null,
    error: null as string | null,
  }
}

export const useRun = create<RunState>((set, get) => ({
  ...freshState(),

  async loadLevel(projectId, levelId) {
    set({ ...freshState(), phase: 'loading' })
    try {
      const { level, freshness } = await api.getLevel(projectId, levelId)
      set({ level, freshness, phase: 'narrative' })
    } catch (err) {
      set({ phase: 'failed', error: err instanceof Error ? err.message : '关卡加载失败' })
    }
  },

  startAnswering() {
    set({ phase: 'answering' })
  },

  answer(correct, taskType) {
    const s = get()
    if (correct) {
      set({
        xpEarned: s.xpEarned + taskXp(taskType, s.combo),
        combo: s.combo + 1,
        maxCombo: Math.max(s.maxCombo, s.combo + 1),
        totalAnswers: s.totalAnswers + 1,
        phase: 'feedback',
        lastCorrect: true,
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
      phase: 'narrative',
      lastCorrect: null,
    })
  },

  // 源码已变化的任务:自动通过,不计入计分(对错都不动)
  skipStale(_taskId) {
    get().nextTask()
  },

  reset() {
    set(freshState())
  },
}))

/** accuracy = (totalAnswers - wrongAnswers) / max(1, totalAnswers) */
export function runAccuracy(s: Pick<RunState, 'totalAnswers' | 'wrongAnswers'>): number {
  return (s.totalAnswers - s.wrongAnswers) / Math.max(1, s.totalAnswers)
}
