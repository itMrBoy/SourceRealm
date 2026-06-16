import type { Task } from '@sourcerealm/shared'

type TreasureHuntTask = Extract<Task, { type: 'treasure-hunt' }>

interface TreasureHuntTaskProps {
  task: TreasureHuntTask
  /** 已答错次数(由 LevelScreen 维护,寻宝在原地重试时累加) */
  wrongCount: number
  /** 当前已勾选行数 */
  selectedCount: number
  /** 提交已勾选行 → 精确匹配判定 */
  onSubmit: () => void
  /** 点击「带我去附近」:在目标 ±20 行窗口高亮 */
  onGuideMe: () => void
}

export function TreasureHuntTask({
  task,
  wrongCount,
  selectedCount,
  onSubmit,
  onGuideMe,
}: TreasureHuntTaskProps): JSX.Element {
  return (
    <div className="tp-task tp-treasure">
      <p className="tp-instruction">{task.instruction}</p>
      <p className="tp-treasure-target">
        在左侧代码中,点击勾选 <strong>{task.target.file}</strong> 里所有相关行,然后提交（空行、标题可不选）。
      </p>
      {wrongCount >= 1 && task.hint && (
        <p className="tp-hint">💡 {task.hint}</p>
      )}
      <div className="tp-actions-row">
        <button
          type="button"
          className="nes-btn is-primary"
          disabled={selectedCount === 0}
          onClick={onSubmit}
        >
          提交（已选 {selectedCount} 行）
        </button>
        {wrongCount >= 2 && (
          <button type="button" className="nes-btn is-warning" onClick={onGuideMe}>
            带我去附近
          </button>
        )}
      </div>
    </div>
  )
}
