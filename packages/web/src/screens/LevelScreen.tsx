import { useCallback, useEffect, useMemo, useState } from 'react'
import { judgeTreasureHunt, type Task } from '@code-quest/shared'
import { useStore } from '../store.js'
import { useRun } from '../game/run.js'
import { CodeBrowser, type HighlightRef } from '../components/CodeBrowser.js'
import { TaskPanel } from '../components/TaskPanel.js'

/** 当前任务涉及的首个 ref 文件(用于自动打开代码浏览器) */
function firstRefFile(task: Task | undefined): string | null {
  if (!task) return null
  if (task.type === 'quiz') return task.refs[0]?.file ?? null
  if (task.type === 'treasure-hunt') return task.target.file
  if (task.type === 'code-fill' || task.type === 'code-type') return task.ref.file
  if (task.type === 'call-chain') {
    for (const it of task.items) if (it.ref) return it.ref.file
  }
  return null
}

export function LevelScreen(): JSX.Element {
  const projectId = useStore((s) => s.projectId)
  const levelId = useStore((s) => s.currentLevelId)
  const setScreen = useStore((s) => s.setScreen)

  const level = useRun((s) => s.level)
  const freshness = useRun((s) => s.freshness)
  const taskIndex = useRun((s) => s.taskIndex)
  const phase = useRun((s) => s.phase)
  const error = useRun((s) => s.error)
  const loadLevel = useRun((s) => s.loadLevel)
  const answer = useRun((s) => s.answer)
  const reset = useRun((s) => s.reset)

  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [highlightRef, setHighlightRef] = useState<HighlightRef | null>(null)
  // 寻宝任务当前题答错次数(每题重置)
  const [treasureWrong, setTreasureWrong] = useState(0)

  // 挂载:加载关卡
  useEffect(() => {
    if (projectId && levelId) void loadLevel(projectId, levelId)
    return () => reset()
  }, [projectId, levelId, loadLevel, reset])

  const task: Task | undefined = level?.tasks[taskIndex]
  const taskCount = level?.tasks.length ?? 0
  const stale = task ? freshness[task.id] === false : false

  // 切题:自动打开首个 ref 文件,重置寻宝错误计数与高亮
  useEffect(() => {
    const file = firstRefFile(task)
    if (file) setActiveFile(file)
    setTreasureWrong(0)
    setHighlightRef(null)
  }, [task])

  const backToMap = useCallback(() => {
    setScreen('map')
  }, [setScreen])

  const exit = useCallback(() => {
    const midRun = phase === 'narrative' || phase === 'answering' || phase === 'feedback'
    if (midRun && !window.confirm('关卡尚未完成,确定退出?进度不会保存。')) return
    setScreen('map')
  }, [phase, setScreen])

  const onAnswer = useCallback(
    (correct: boolean, _task: Task) => {
      if (!_task) return
      answer(correct, _task.type)
    },
    [answer],
  )

  // 寻宝:浏览器行点击 → 判定
  const onLineClick = useCallback(
    (file: string, line: number) => {
      if (!task || task.type !== 'treasure-hunt') return
      if (phase !== 'answering') return
      const correct = judgeTreasureHunt(task.target, { file, line })
      if (!correct) setTreasureWrong((n) => n + 1)
      answer(correct, 'treasure-hunt')
    },
    [task, phase, answer],
  )

  // 寻宝重试本题时重置高亮(保留错误计数以便逐步给提示)
  const onGuideMe = useCallback(() => {
    if (!task || task.type !== 'treasure-hunt') return
    const t = task.target
    setActiveFile(t.file)
    setHighlightRef({
      file: t.file,
      startLine: Math.max(1, t.startLine - 20),
      endLine: t.endLine + 20,
    })
  }, [task])

  const isTreasure = task?.type === 'treasure-hunt'
  const lineClickHandler = useMemo(
    () => (isTreasure ? onLineClick : undefined),
    [isTreasure, onLineClick],
  )

  if (!projectId || !levelId) {
    return (
      <div className="level">
        <p className="level-msg">未选择关卡。</p>
        <button type="button" className="nes-btn" onClick={backToMap}>
          返回地图
        </button>
      </div>
    )
  }

  return (
    <div className="level">
      <div className="level-bar">
        <span className="level-bar-title" title={level?.title ?? ''}>
          {phase === 'loading' ? '加载中…' : (level?.title ?? '关卡')}
        </span>
        <button type="button" className="nes-btn level-exit" onClick={exit}>
          退出
        </button>
      </div>

      {phase === 'loading' && <p className="level-msg blink">关卡加载中…</p>}

      {phase === 'failed' && error && (
        <div className="level-msg level-error">
          <p>{error}</p>
          <button type="button" className="nes-btn" onClick={backToMap}>
            返回地图
          </button>
        </div>
      )}

      {level && phase !== 'loading' && !(phase === 'failed' && error) && (
        <div className="level-grid">
          <div className="level-left">
            <CodeBrowser
              projectId={projectId}
              files={level.files}
              activeFile={activeFile}
              onSelectFile={setActiveFile}
              onLineClick={lineClickHandler}
              highlightRef={highlightRef}
            />
          </div>
          <div className="level-right">
            {task && (
              <TaskPanel
                task={task}
                taskIndex={taskIndex}
                taskCount={taskCount}
                stale={stale}
                onAnswer={onAnswer}
                onBackToMap={backToMap}
                treasureWrongCount={treasureWrong}
                onGuideMe={onGuideMe}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
