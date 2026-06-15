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
  return { xp: 0, completedLevels: {}, badges: [], filesRead: [], levelRuns: {} }
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
