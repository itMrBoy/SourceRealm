import type { Task } from '@sourcerealm/shared'

type TreasureHuntTask = Extract<Task, { type: 'treasure-hunt' }>

interface TreasureHuntTaskProps {
  task: TreasureHuntTask
  /** 已答错次数(由 LevelScreen 维护,寻宝在原地重试时累加) */
  wrongCount: number
  /** 点击「带我去附近」:在目标 ±20 行窗口高亮 */
  onGuideMe: () => void
}

export function TreasureHuntTask({
  task,
  wrongCount,
  onGuideMe,
}: TreasureHuntTaskProps): JSX.Element {
  return (
    <div className="tp-task tp-treasure">
      <p className="tp-instruction">{task.instruction}</p>
      <p className="tp-treasure-target">
        在左侧代码中,点击 <strong>{task.target.file}</strong> 的对应行。
      </p>
      {wrongCount >= 1 && task.hint && (
        <p className="tp-hint">💡 {task.hint}</p>
      )}
      {wrongCount >= 2 && (
        <button type="button" className="nes-btn is-warning" onClick={onGuideMe}>
          带我去附近
        </button>
      )}
    </div>
  )
}
