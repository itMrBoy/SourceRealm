import { useState } from 'react'
import { judgeQuiz, type Task } from '@code-quest/shared'

type QuizTask = Extract<Task, { type: 'quiz' }>

interface QuizTaskProps {
  task: QuizTask
  onAnswer: (correct: boolean) => void
}

export function QuizTask({ task, onAnswer }: QuizTaskProps): JSX.Element {
  const multi = task.answer.length > 1
  const [selected, setSelected] = useState<number[]>([])

  function single(i: number): void {
    onAnswer(judgeQuiz([...task.answer], [i]))
  }

  function toggle(i: number): void {
    setSelected((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]))
  }

  function submit(): void {
    onAnswer(judgeQuiz([...task.answer], selected))
  }

  return (
    <div className="tp-task tp-quiz">
      <p className="tp-question">{task.question}</p>
      {multi ? (
        <>
          <div className="tp-options">
            {task.options.map((opt, i) => (
              <label key={i} className="tp-checkbox">
                <input
                  type="checkbox"
                  className="nes-checkbox"
                  checked={selected.includes(i)}
                  onChange={() => toggle(i)}
                />
                <span>{opt}</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            className="nes-btn is-primary"
            disabled={selected.length === 0}
            onClick={submit}
          >
            提交
          </button>
        </>
      ) : (
        <div className="tp-options">
          {task.options.map((opt, i) => (
            <button
              key={i}
              type="button"
              className="nes-btn tp-option-btn"
              onClick={() => single(i)}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
