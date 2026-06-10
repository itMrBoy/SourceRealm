import { useEffect, useMemo, useRef, useState } from 'react'
import { judgeCodeType, type Task } from '@code-quest/shared'
import * as api from '../../api.js'
import { useStore } from '../../store.js'

type CodeTypeTask = Extract<Task, { type: 'code-type' }>

interface CodeTypeTaskProps {
  task: CodeTypeTask
  onAnswer: (correct: boolean) => void
}

/** 去掉每行行尾空白,保留换行结构 */
function normalizeTarget(snippet: string): string {
  return snippet
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
}

/** 取 expected 中从 pos 开始那一行的前导空白(空格/Tab 连续段) */
function leadingWhitespaceAt(expected: string, pos: number): string {
  let i = pos
  let ws = ''
  while (i < expected.length && (expected[i] === ' ' || expected[i] === '\t')) {
    ws += expected[i]
    i++
  }
  return ws
}

const SKIP_DELAY_MS = 60_000

export function CodeTypeTask({ task, onAnswer }: CodeTypeTaskProps): JSX.Element {
  const projectId = useStore((s) => s.projectId)
  const [expected, setExpected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [canSkip, setCanSkip] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const doneRef = useRef(false)

  // 加载并归一化片段
  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    setExpected(null)
    setError(null)
    setTyped('')
    setStartedAt(null)
    doneRef.current = false
    api
      .getFile(projectId, task.ref.file)
      .then((content) => {
        if (cancelled) return
        const slice = content.split('\n').slice(task.ref.startLine - 1, task.ref.endLine).join('\n')
        setExpected(normalizeTarget(slice))
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '片段加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [projectId, task.ref.file, task.ref.startLine, task.ref.endLine, task.id])

  // 60s 后允许跳过
  useEffect(() => {
    const t = setTimeout(() => setCanSkip(true), SKIP_DELAY_MS)
    return () => clearTimeout(t)
  }, [task.id])

  // WPM 实时刷新
  useEffect(() => {
    if (startedAt === null || doneRef.current) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [startedAt])

  // 进入题目自动聚焦
  useEffect(() => {
    taRef.current?.focus()
  }, [expected])

  const stats = useMemo(
    () => (expected === null ? null : judgeCodeType(expected, typed)),
    [expected, typed],
  )

  // 完成 → onAnswer(true)(此类型不会判错)
  useEffect(() => {
    if (stats?.complete && !doneRef.current) {
      doneRef.current = true
      onAnswer(true)
    }
  }, [stats, onAnswer])

  function applyTyped(next: string): void {
    if (doneRef.current || expected === null) return
    if (startedAt === null && next.length > 0) setStartedAt(Date.now())
    setTyped(next.length > expected.length ? next.slice(0, expected.length) : next)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (expected === null || doneRef.current) return
    if (e.key === 'Tab') {
      e.preventDefault()
      applyTyped(typed + '  ')
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      // 自动补全下一行前导空白:换行后追加下一行行首空白
      const ws = leadingWhitespaceAt(expected, typed.length + 1)
      applyTyped(typed + '\n' + ws)
      return
    }
    if (e.key === 'Backspace') {
      e.preventDefault()
      applyTyped(typed.slice(0, -1))
      return
    }
    // 单字符按键交给 onChange 处理(支持输入法/普通字符)
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    applyTyped(e.target.value)
  }

  if (error) {
    return (
      <div className="tp-task ct">
        <p className="cb-error">{error}</p>
      </div>
    )
  }
  if (expected === null || stats === null) {
    return (
      <div className="tp-task ct">
        <p className="tp-instruction blink">片段加载中…</p>
      </div>
    )
  }

  const elapsedMin = startedAt === null ? 0 : (now - startedAt) / 60_000
  const wpm = elapsedMin > 0 ? Math.round(typed.length / 5 / elapsedMin) : 0
  const accuracyPct = Math.round(stats.accuracy * 100)
  const progressPct = Math.round((typed.length / expected.length) * 100)
  const wrongCount = typed.length - stats.correct
  const golden = stats.complete && stats.accuracy >= 0.9

  return (
    <div className="tp-task ct">
      <p className="tp-instruction">临摹下方代码(金山打字通玩法)。回车自动缩进、Tab 输入两个空格。</p>

      <div className="ct-stats">
        <span>实时 WPM:{wpm}</span>
        <span>准确率:{accuracyPct}%</span>
        <span>进度:{progressPct}%</span>
        <span className={wrongCount > 0 ? 'ct-wrong' : ''}>错字数:{wrongCount}</span>
      </div>

      <div
        className={`ct-display code-font ${golden ? 'ct-display--gold' : ''}`}
        onClick={() => taRef.current?.focus()}
        role="textbox"
        tabIndex={-1}
      >
        {Array.from(expected).map((ch, i) => {
          let cls = 'ct-char'
          if (i < typed.length) cls += typed[i] === ch ? ' ct-char--ok' : ' ct-char--bad'
          else if (i === typed.length) cls += ' ct-char--caret'
          // 换行符渲染为可见的 ↵ 并真正换行
          if (ch === '\n') {
            return (
              <span key={i} className={cls}>
                {i === typed.length ? ' ' : ''}
                {'\n'}
              </span>
            )
          }
          return (
            <span key={i} className={cls}>
              {ch}
            </span>
          )
        })}
        {/* 末尾光标 */}
        {typed.length >= expected.length && !stats.complete && (
          <span className="ct-char ct-char--caret">{' '}</span>
        )}
      </div>

      <textarea
        ref={taRef}
        className="ct-hidden-input"
        value={typed}
        onChange={onChange}
        onKeyDown={onKeyDown}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        aria-label="打字输入区"
      />

      {stats.complete && (
        <p className={`ct-complete ${golden ? 'ct-complete--gold' : ''}`}>
          {golden ? '✦ 完美临摹!' : '✓ 完成临摹!'}
        </p>
      )}

      {canSkip && !stats.complete && (
        <a
          className="ct-skip"
          role="button"
          tabIndex={0}
          onClick={() => onAnswer(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onAnswer(false)
          }}
        >
          跳过此题
        </a>
      )}
    </div>
  )
}
