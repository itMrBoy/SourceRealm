import { TITLES, levelInfo } from '@sourcerealm/shared'
import { useStore } from '../store.js'

export function Hud(): JSX.Element {
  const progress = useStore((s) => s.progress)
  const projectName = useStore((s) => s.projectName)

  const info = levelInfo(progress.xp)

  // XP 进度:从当前称号区间下界填到 nextAt;nextAt 为 null 时已满级
  const lower = lowerBound(progress.xp)
  const span = info.nextAt === null ? 1 : Math.max(1, info.nextAt - lower)
  const filled = info.nextAt === null ? 1 : Math.min(1, Math.max(0, (progress.xp - lower) / span))

  return (
    <header className="hud">
      <div className="hud-left">
        <span className="hud-title">
          Lv.{info.level} {info.title}
        </span>
        <div className="hud-xp" title={`XP ${progress.xp}${info.nextAt === null ? ' (满级)' : ` / ${info.nextAt}`}`}>
          <div className="hud-xp-bar">
            <div className="hud-xp-fill" style={{ width: `${Math.round(filled * 100)}%` }} />
          </div>
          <span className="hud-xp-text">
            {info.nextAt === null ? `XP ${progress.xp} · MAX` : `${progress.xp} / ${info.nextAt}`}
          </span>
        </div>
      </div>

      <div className="hud-center">
        <span className="hud-project" title={projectName}>
          {projectName || '未命名项目'}
        </span>
      </div>
    </header>
  )
}

/** 返回 xp 所处称号区间的下界 XP(用于计算进度条) */
function lowerBound(xp: number): number {
  let lower = 0
  for (const t of TITLES) if (xp >= t.xp) lower = t.xp
  return lower
}
