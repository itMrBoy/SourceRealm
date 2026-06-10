import { useEffect, useRef, useState } from 'react'
import type { Task } from '@code-quest/shared'
import { useRun, runAccuracy } from '../game/run.js'
import { QuizTask } from './tasks/QuizTask.js'
import { TreasureHuntTask } from './tasks/TreasureHuntTask.js'

interface TaskPanelProps {
  task: Task
  taskIndex: number
  taskCount: number
  /** freshness===false 的任务降级处理 */
  stale: boolean
  onAnswer: (correct: boolean, task: Task) => void
  onBackToMap: () => void
  /** 寻宝:当前题已答错次数 */
  treasureWrongCount: number
  onGuideMe: () => void
}

export function TaskPanel({
  task,
  taskIndex,
  taskCount,
  stale,
  onAnswer,
  onBackToMap,
  treasureWrongCount,
  onGuideMe,
}: TaskPanelProps): JSX.Element {
  const phase = useRun((s) => s.phase)
  const hearts = useRun((s) => s.hearts)
  const combo = useRun((s) => s.combo)
  const lastCorrect = useRun((s) => s.lastCorrect)
  const xpEarned = useRun((s) => s.xpEarned)
  const maxCombo = useRun((s) => s.maxCombo)
  const totalAnswers = useRun((s) => s.totalAnswers)
  const wrongAnswers = useRun((s) => s.wrongAnswers)
  const startAnswering = useRun((s) => s.startAnswering)
  const nextTask = useRun((s) => s.nextTask)
  const retryTask = useRun((s) => s.retryTask)
  const retryLevel = useRun((s) => s.retryLevel)
  const skipStale = useRun((s) => s.skipStale)

  // 源码已变化:自动跳过(不计分)
  useEffect(() => {
    if (stale && (phase === 'narrative' || phase === 'answering')) {
      const t = setTimeout(() => skipStale(task.id), 900)
      return () => clearTimeout(t)
    }
  }, [stale, phase, task.id, skipStale])

  return (
    <div className="tp">
      <div className="tp-status">
        <span className="tp-progress">
          任务 {taskIndex + 1}/{taskCount}
        </span>
        <span className="tp-hearts" title={`剩余 ${hearts} 颗心`}>
          {'❤️'.repeat(Math.max(0, hearts))}
        </span>
        {combo > 1 && <span className="tp-combo blink">连击 x{combo}</span>}
      </div>

      {stale ? (
        <StaleCard />
      ) : phase === 'narrative' ? (
        <Narrative key={task.id} text={task.narrative} onContinue={startAnswering} />
      ) : phase === 'answering' ? (
        <Answering
          task={task}
          onAnswer={(correct) => onAnswer(correct, task)}
          treasureWrongCount={treasureWrongCount}
          onGuideMe={onGuideMe}
        />
      ) : phase === 'feedback' ? (
        <Feedback
          task={task}
          correct={lastCorrect === true}
          hearts={hearts}
          onNext={nextTask}
          onRetry={retryTask}
        />
      ) : phase === 'failed' ? (
        <Failed onRetryLevel={retryLevel} onBackToMap={onBackToMap} />
      ) : phase === 'level-done' ? (
        <LevelDone
          xp={xpEarned}
          maxCombo={maxCombo}
          accuracy={runAccuracy({ totalAnswers, wrongAnswers })}
          onBackToMap={onBackToMap}
        />
      ) : null}
    </div>
  )
}

function StaleCard(): JSX.Element {
  return (
    <div className="nes-container is-rounded tp-stale">
      <p>⚠ 源码已变化,本题跳过</p>
    </div>
  )
}

function Narrative({
  text,
  onContinue,
}: {
  text: string
  onContinue: () => void
}): JSX.Element {
  const [shown, setShown] = useState('')
  const done = shown.length >= text.length
  const idx = useRef(0)

  useEffect(() => {
    idx.current = 0
    setShown('')
    const timer = setInterval(() => {
      idx.current += 1
      setShown(text.slice(0, idx.current))
      if (idx.current >= text.length) clearInterval(timer)
    }, 35)
    return () => clearInterval(timer)
  }, [text])

  return (
    <div className="tp-narrative">
      <div className="nes-balloon from-left tp-balloon" onClick={() => setShown(text)}>
        <p>{shown}</p>
      </div>
      <button
        type="button"
        className="nes-btn is-primary"
        disabled={!done}
        onClick={onContinue}
      >
        {done ? '继续' : '…'}
      </button>
    </div>
  )
}

function Answering({
  task,
  onAnswer,
  treasureWrongCount,
  onGuideMe,
}: {
  task: Task
  onAnswer: (correct: boolean) => void
  treasureWrongCount: number
  onGuideMe: () => void
}): JSX.Element {
  switch (task.type) {
    case 'quiz':
      return <QuizTask task={task} onAnswer={onAnswer} />
    case 'treasure-hunt':
      return (
        <TreasureHuntTask
          task={task}
          wrongCount={treasureWrongCount}
          onGuideMe={onGuideMe}
        />
      )
    default:
      return (
        <div className="nes-container is-rounded tp-todo">
          <p>该任务类型即将实现</p>
          <p className="tp-todo-type">({task.type})</p>
        </div>
      )
  }
}

function Feedback({
  task,
  correct,
  hearts,
  onNext,
  onRetry,
}: {
  task: Task
  correct: boolean
  hearts: number
  onNext: () => void
  onRetry: () => void
}): JSX.Element {
  const hint =
    task.type === 'treasure-hunt' ? task.hint : undefined
  return (
    <div className={`tp-feedback ${correct ? 'tp-feedback--ok' : 'tp-feedback--no'}`}>
      {correct ? (
        <>
          <p className="tp-feedback-head">✓ 答对了!</p>
          <p className="tp-explanation">{task.explanation}</p>
          <button type="button" className="nes-btn is-success" onClick={onNext}>
            下一题
          </button>
        </>
      ) : (
        <>
          <p className="tp-feedback-head">✗ 答错了</p>
          <p className="tp-feedback-hearts">还剩 {hearts} 颗心</p>
          {hint && <p className="tp-hint">💡 {hint}</p>}
          <button type="button" className="nes-btn is-warning" onClick={onRetry}>
            重试本题
          </button>
        </>
      )}
    </div>
  )
}

function Failed({
  onRetryLevel,
  onBackToMap,
}: {
  onRetryLevel: () => void
  onBackToMap: () => void
}): JSX.Element {
  return (
    <div className="nes-container is-dark is-rounded tp-failed">
      <p className="tp-failed-head">💀 生命耗尽</p>
      <p>本关挑战失败,要再来一次吗?</p>
      <div className="tp-actions-row">
        <button type="button" className="nes-btn is-error" onClick={onRetryLevel}>
          重新挑战本关
        </button>
        <button type="button" className="nes-btn" onClick={onBackToMap}>
          返回地图
        </button>
      </div>
    </div>
  )
}

function LevelDone({
  xp,
  maxCombo,
  accuracy,
  onBackToMap,
}: {
  xp: number
  maxCombo: number
  accuracy: number
  onBackToMap: () => void
}): JSX.Element {
  return (
    <div className="nes-container is-dark is-rounded tp-done">
      <p className="tp-done-head">🎉 本关完成!</p>
      <ul className="tp-done-stats">
        <li>获得 XP:{xp}</li>
        <li>最高连击:x{maxCombo}</li>
        <li>正确率:{Math.round(accuracy * 100)}%</li>
      </ul>
      <button type="button" className="nes-btn is-primary" onClick={onBackToMap}>
        返回地图
      </button>
    </div>
  )
}
