import { levelInfo, type Rating } from '@code-quest/shared'
import { useStore } from '../store.js'
import { Hud } from '../components/Hud.js'
import { playClick, unlockAudio } from '../game/audio.js'

const RATING_ORDER: Rating[] = ['S', 'A', 'B', 'C']

/** 众数评级:出现次数最多者;并列时取更高评级 */
function modeRating(ratings: Rating[]): Rating | null {
  if (ratings.length === 0) return null
  const counts = new Map<Rating, number>()
  for (const r of ratings) counts.set(r, (counts.get(r) ?? 0) + 1)
  let best: Rating = 'C'
  let bestCount = -1
  for (const r of RATING_ORDER) {
    const c = counts.get(r) ?? 0
    if (c > bestCount) {
      best = r
      bestCount = c
    }
  }
  return best
}

export function CertScreen(): JSX.Element {
  const progress = useStore((s) => s.progress)
  const projectName = useStore((s) => s.projectName)
  const setScreen = useStore((s) => s.setScreen)

  const graduated = progress.badges.includes('graduate')
  const completions = Object.values(progress.completedLevels)
  const ratings = completions.map((c) => c.rating)
  const avg = modeRating(ratings)
  const info = levelInfo(progress.xp)
  const date = new Date().toLocaleDateString('zh-CN')

  const back = () => {
    unlockAudio()
    playClick()
    setScreen('map')
  }

  if (!graduated) {
    return (
      <div className="cert">
        <Hud />
        <main className="cert-main">
          <div className="nes-container is-rounded cert-locked">
            <p>🔒 通关全部关卡后可领取证书。</p>
            <button type="button" className="nes-btn" onClick={back}>
              返回地图
            </button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="cert">
      <div className="cert-hud">
        <Hud />
      </div>
      <main className="cert-main">
        <div className="cert-card">
          <h1 className="cert-card-title">🏆 通关证书</h1>
          <p className="cert-project">{projectName || '未命名项目'}</p>
          <p className="cert-line">已通关「源界 SourceRealm」源码闯关</p>
          <ul className="cert-stats">
            <li>总 XP:{progress.xp}</li>
            <li>通关关卡:{completions.length}</li>
            <li>平均评级:{avg ?? '—'}</li>
          </ul>
          <p className="cert-title-line">称号:Lv.{info.level} {info.title}</p>
          <p className="cert-date">{date}</p>
        </div>
        <div className="cert-actions">
          <button type="button" className="nes-btn is-primary" onClick={() => window.print()}>
            打印证书
          </button>
          <button type="button" className="nes-btn cert-back" onClick={back}>
            返回地图
          </button>
        </div>
      </main>
    </div>
  )
}
