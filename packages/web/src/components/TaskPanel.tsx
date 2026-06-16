import { useEffect, useRef, useState } from 'react'
import type { SavedAnswer, Task } from '@sourcerealm/shared'
import { useRun } from '../game/run.js'
import { QuizTask } from './tasks/QuizTask.js'
import { TreasureHuntTask } from './tasks/TreasureHuntTask.js'
import { CallChainTask } from './tasks/CallChainTask.js'
import { CodeFillTask } from './tasks/CodeFillTask.js'
import { CodeTypeTask } from './tasks/CodeTypeTask.js'
import { playClick, playCombo, playCorrect, playWrong, unlockAudio } from '../game/audio.js'

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
  const level = useRun((s) => s.level)
  const hearts = useRun((s) => s.hearts)
  const combo = useRun((s) => s.combo)
  const lastCorrect = useRun((s) => s.lastCorrect)
  const answeredHistory = useRun((s) => s.answeredHistory)
  const startAnswering = useRun((s) => s.startAnswering)
  const nextTask = useRun((s) => s.nextTask)
  const retryTask = useRun((s) => s.retryTask)
  const retryLevel = useRun((s) => s.retryLevel)
  const skipStale = useRun((s) => s.skipStale)
  // 正在回顾的题号(null 表示未打开回顾);可在 0..taskIndex-1 间双向翻页
  const [reviewIndex, setReviewIndex] = useState<number | null>(null)

  const canViewPrevious = taskIndex > 0 && Boolean(level?.tasks[taskIndex - 1])
  const reviewTask = reviewIndex !== null ? level?.tasks[reviewIndex] : undefined
  const reviewAnswer =
    reviewIndex !== null ? answeredHistory.find((a) => a.taskIndex === reviewIndex) : undefined

  // 切到新题时关闭回顾弹窗,避免停留在旧索引
  useEffect(() => {
    setReviewIndex(null)
  }, [task.id])

  // 源码已变化:自动跳过(不计分)
  useEffect(() => {
    if (stale && (phase === 'narrative' || phase === 'answering')) {
      const t = setTimeout(() => skipStale(task.id), 900)
      return () => clearTimeout(t)
    }
  }, [stale, phase, task.id, skipStale])

  // 答题反馈音效:进入 feedback(或答错耗尽进 failed)时,按对错播放
  const sounded = useRef(0)
  useEffect(() => {
    if (lastCorrect === null) {
      sounded.current = 0
      return
    }
    // 同一答案只响一次:用 totalAnswers 变化作为去重键由 run 驱动,这里以 phase 进入为触发
    if (phase === 'feedback' || phase === 'failed') {
      if (sounded.current === 1) return
      sounded.current = 1
      if (lastCorrect) {
        playCorrect()
        if (combo > 1) playCombo(combo)
      } else {
        playWrong()
      }
    }
  }, [phase, lastCorrect, combo])

  const click = () => {
    unlockAudio()
    playClick()
  }

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
        {canViewPrevious && (
          <button
            type="button"
            className="nes-btn tp-prev-btn"
            onClick={() => {
              click()
              setReviewIndex(taskIndex - 1)
            }}
          >
            上一题
          </button>
        )}
      </div>

      {reviewIndex !== null && reviewTask && (
        <PreviousReview
          task={reviewTask}
          reviewIndex={reviewIndex}
          answer={reviewAnswer}
          canGoEarlier={reviewIndex > 0}
          canGoLater={reviewIndex < taskIndex - 1}
          onEarlier={() => {
            click()
            setReviewIndex((i) => (i !== null && i > 0 ? i - 1 : i))
          }}
          onLater={() => {
            click()
            setReviewIndex((i) => (i !== null && i < taskIndex - 1 ? i + 1 : i))
          }}
          onClose={() => setReviewIndex(null)}
        />
      )}

      {stale ? (
        <StaleCard />
      ) : phase === 'narrative' ? (
        <Narrative
          key={task.id}
          text={task.narrative}
          onContinue={() => {
            click()
            startAnswering()
          }}
        />
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
          onNext={() => {
            click()
            nextTask()
          }}
          onRetry={() => {
            click()
            retryTask()
          }}
        />
      ) : phase === 'failed' ? (
        <Failed
          onRetryLevel={() => {
            click()
            retryLevel()
          }}
          onBackToMap={() => {
            click()
            onBackToMap()
          }}
        />
      ) : null}
    </div>
  )
}

function PreviousReview({
  task,
  reviewIndex,
  answer,
  canGoEarlier,
  canGoLater,
  onEarlier,
  onLater,
  onClose,
}: {
  task: Task
  reviewIndex: number
  answer: SavedAnswer | undefined
  canGoEarlier: boolean
  canGoLater: boolean
  onEarlier: () => void
  onLater: () => void
  onClose: () => void
}): JSX.Element {
  // 源码已变化被跳过的题没有作答记录,讲解文案回退到题目自带的 explanation
  const explanation = answer?.explanation ?? task.explanation
  return (
    <div className="nes-container is-rounded is-dark tp-review">
      <div className="tp-review-head">
        <span>回顾 第 {reviewIndex + 1} 题</span>
        <button type="button" className="nes-btn tp-review-close" onClick={onClose}>
          关闭
        </button>
      </div>
      <p className="tp-review-narrative">{task.narrative}</p>
      <p className="tp-review-question">{taskPrompt(task)}</p>
      {answer ? (
        <p className={answer.correct ? 'tp-review-ok' : 'tp-review-no'}>
          作答结果:{answer.correct ? '答对' : '答错'}
        </p>
      ) : (
        <p className="tp-review-skip">本题已跳过(源码已变化)</p>
      )}
      <p className="tp-explanation">{explanation}</p>
      <div className="tp-review-nav">
        {canGoEarlier && (
          <button type="button" className="nes-btn tp-review-prev" onClick={onEarlier}>
            ← 更前一题
          </button>
        )}
        {canGoLater && (
          <button type="button" className="nes-btn tp-review-next" onClick={onLater}>
            后一题 →
          </button>
        )}
      </div>
    </div>
  )
}

function taskPrompt(task: Task): string {
  switch (task.type) {
    case 'quiz':
      return `问题:${task.question}`
    case 'treasure-hunt':
      return `寻宝:${task.instruction}`
    case 'call-chain':
      return `调用链:${task.items.map((it) => it.label).join(' → ')}`
    case 'code-fill':
      return `填空:${task.ref.file}:${task.ref.startLine}-${task.ref.endLine}`
    case 'code-type':
      return `临摹:${task.ref.file}:${task.ref.startLine}-${task.ref.endLine}`
  }
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
    case 'call-chain':
      return <CallChainTask task={task} onAnswer={onAnswer} />
    case 'code-fill':
      return <CodeFillTask task={task} onAnswer={onAnswer} />
    case 'code-type':
      return <CodeTypeTask task={task} onAnswer={onAnswer} />
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
