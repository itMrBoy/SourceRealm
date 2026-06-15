import { BADGE_INFO } from '@sourcerealm/shared'
import { useStore } from '../store.js'
import { Hud } from '../components/Hud.js'
import { playClick, unlockAudio } from '../game/audio.js'

interface BadgeEntry {
  id: string
  title: string
  desc: string
}

export function BadgesScreen(): JSX.Element {
  const course = useStore((s) => s.course)
  const progress = useStore((s) => s.progress)
  const setScreen = useStore((s) => s.setScreen)

  // 内置徽章 + 各章节的 chapter-* 通关徽章
  const entries: BadgeEntry[] = [
    ...Object.entries(BADGE_INFO).map(([id, info]) => ({ id, ...info })),
    ...(course?.chapters ?? []).map((ch) => ({
      id: `chapter-${ch.id}`,
      title: `通关·${ch.title}`,
      desc: '通关本章节全部关卡',
    })),
  ]

  const owned = new Set(progress.badges)

  const back = () => {
    unlockAudio()
    playClick()
    setScreen('map')
  }

  return (
    <div className="badges">
      <Hud />
      <main className="badges-main">
        <h1 className="badges-title">⭐ 徽章墙</h1>
        <p className="badges-sub">
          已获得 {entries.filter((e) => owned.has(e.id)).length} / {entries.length}
        </p>
        <div className="badges-grid">
          {entries.map((e) => {
            const lit = owned.has(e.id)
            return (
              <div
                key={e.id}
                className={`badges-cell ${lit ? 'badges-cell--lit' : 'badges-cell--dim'}`}
                title={e.desc}
              >
                <div className="badges-icon">{lit ? '🏅' : '🔒'}</div>
                <div className="badges-name">{e.title}</div>
                <div className="badges-desc">{e.desc}</div>
              </div>
            )
          })}
        </div>
        <button type="button" className="nes-btn badges-back" onClick={back}>
          返回地图
        </button>
      </main>
    </div>
  )
}
