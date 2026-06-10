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
