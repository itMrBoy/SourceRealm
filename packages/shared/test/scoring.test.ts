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
