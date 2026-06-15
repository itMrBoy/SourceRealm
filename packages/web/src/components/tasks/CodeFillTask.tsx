import { useEffect, useState } from 'react'
import { judgeCodeFill, type Task } from '@sourcerealm/shared'
import * as api from '../../api.js'
import { useStore } from '../../store.js'

type CodeFillTask = Extract<Task, { type: 'code-fill' }>

interface CodeFillTaskProps {
  task: CodeFillTask
  onAnswer: (correct: boolean) => void
}

export function CodeFillTask({ task, onAnswer }: CodeFillTaskProps): JSX.Element {
  const projectId = useStore((s) => s.projectId)
  const [lines, setLines] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 按 blankLines 顺序保存输入
  const [inputs, setInputs] = useState<string[]>(() => task.blankLines.map(() => ''))

  useEffect(() => {
    setInputs(task.blankLines.map(() => ''))
  }, [task.id, task.blankLines])

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    setLines(null)
    setError(null)
    api
      .getFile(projectId, task.ref.file)
      .then((content) => {
        if (cancelled) return
        const all = content.split('\n')
        // ref 行号为 1-based,截取 [startLine..endLine]
        setLines(all.slice(task.ref.startLine - 1, task.ref.endLine))
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '片段加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [projectId, task.ref.file, task.ref.startLine, task.ref.endLine])

  function setInput(blankIdx: number, value: string): void {
    setInputs((prev) => {
      const next = [...prev]
      next[blankIdx] = value
      return next
    })
  }

  function submit(): void {
    onAnswer(judgeCodeFill([...task.answers], inputs))
  }

  if (error) {
    return (
      <div className="tp-task cf">
        <p className="cb-error">{error}</p>
      </div>
    )
  }
  if (!lines) {
    return (
      <div className="tp-task cf">
        <p className="tp-instruction blink">片段加载中…</p>
      </div>
    )
  }

  return (
    <div className="tp-task cf">
      <p className="tp-instruction">补全下方代码中缺失的部分。</p>
      <pre className="cf-code code-font">
        {lines.map((text, i) => {
          const lineNo = task.ref.startLine + i
          const blankIdx = task.blankLines.indexOf(lineNo)
          return (
            <div key={lineNo} className="cf-line">
              <span className="cf-ln">{lineNo}</span>
              {blankIdx === -1 ? (
                <span className="cf-text">{text}</span>
              ) : (
                <input
                  type="text"
                  className="nes-input code-font cf-input"
                  placeholder={`??? (第 ${lineNo} 行)`}
                  value={inputs[blankIdx]}
                  onChange={(e) => setInput(blankIdx, e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
              )}
            </div>
          )
        })}
      </pre>
      <button
        type="button"
        className="nes-btn is-primary"
        disabled={inputs.some((v) => v.trim() === '')}
        onClick={submit}
      >
        提交
      </button>
    </div>
  )
}
