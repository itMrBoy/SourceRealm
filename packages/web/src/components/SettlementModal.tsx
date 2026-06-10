import { useEffect, useRef, useState } from 'react'
import { BADGE_INFO } from '@code-quest/shared'
import type { Settlement } from '../game/run.js'
import { playBadge, playLevelClear } from '../game/audio.js'

interface SettlementModalProps {
  settlement: Settlement
  /** course 章节标题映射,用于 chapter-* 徽章文案 */
  chapterTitles: Record<string, string>
  onBackToMap: () => void
  onRetry: () => void
}

const RATING_CLASS: Record<string, string> = {
  S: 'settle-rating--s',
  A: 'settle-rating--a',
  B: 'settle-rating--b',
  C: 'settle-rating--c',
}

/** 徽章文案:内置 BADGE_INFO 优先,chapter-* 用章节标题。 */
function badgeTitle(id: string, chapterTitles: Record<string, string>): string {
  if (BADGE_INFO[id]) return BADGE_INFO[id].title
  if (id.startsWith('chapter-')) {
    const chId = id.slice('chapter-'.length)
    return `通关·${chapterTitles[chId] ?? chId}`
  }
  return id
}

export function SettlementModal({
  settlement,
  chapterTitles,
  onBackToMap,
  onRetry,
}: SettlementModalProps): JSX.Element {
  const { rating, accuracy, maxCombo, xp, newBadges } = settlement
  const chapterComplete = newBadges.some((b) => b.startsWith('chapter-'))
  // 章节通关烟花仅展示 3s
  const [fireworks, setFireworks] = useState(chapterComplete)

  // 开场:通关小调;每枚新徽章错峰播放 fanfare
  const played = useRef(false)
  useEffect(() => {
    if (played.current) return
    played.current = true
    playLevelClear()
    newBadges.forEach((_, i) => {
      window.setTimeout(() => playBadge(), 700 + i * 500)
    })
    if (chapterComplete) {
      const t = window.setTimeout(() => setFireworks(false), 3000)
      return () => window.clearTimeout(t)
    }
  }, [newBadges, chapterComplete])

  return (
    <div className="settle-overlay">
      {fireworks && <Fireworks />}
      <div className="nes-container is-rounded is-dark settle-card">
        <p className="settle-head">🎉 关卡通关!</p>
        <div className={`settle-rating ${RATING_CLASS[rating] ?? ''}`}>{rating}</div>
        <ul className="settle-stats">
          <li>正确率:{Math.round(accuracy * 100)}%</li>
          <li>最高连击:x{maxCombo}</li>
          <li>获得 XP:{xp}</li>
        </ul>

        {newBadges.length > 0 && (
          <div className="settle-badges">
            <p className="settle-badges-head">🏅 获得新徽章</p>
            <ul className="settle-badge-list">
              {newBadges.map((b) => (
                <li key={b} className="settle-badge-item">
                  {badgeTitle(b, chapterTitles)}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="settle-actions">
          <button type="button" className="nes-btn is-primary" onClick={onBackToMap}>
            返回地图
          </button>
          <button type="button" className="nes-btn is-warning" onClick={onRetry}>
            再玩一次
          </button>
        </div>
      </div>
    </div>
  )
}

/** CSS 像素烟花覆盖层(章节全通时短暂展示) */
function Fireworks(): JSX.Element {
  const particles = Array.from({ length: 24 })
  return (
    <div className="fireworks" aria-hidden>
      {particles.map((_, i) => (
        <span key={i} className={`fw-particle fw-p${i % 8}`} style={{ ['--i' as string]: i }} />
      ))}
    </div>
  )
}
