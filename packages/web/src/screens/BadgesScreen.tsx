import { BADGE_INFO } from '@sourcerealm/shared'
import { useStore } from '../store.js'
import { Hud } from '../components/Hud.js'
import { playClick, unlockAudio } from '../game/audio.js'
import * as api from '../api.js'

interface BadgeEntry {
  id: string
  title: string
  desc: string
}

export function BadgesScreen(): JSX.Element {
  const course = useStore((s) => s.course)
  const progress = useStore((s) => s.progress)
  const projectId = useStore((s) => s.projectId)
  const badgesReturnRun = useStore((s) => s.badgesReturnRun)
  const setScreen = useStore((s) => s.setScreen)
  const setProgress = useStore((s) => s.setProgress)
  const setBadgesReturnRun = useStore((s) => s.setBadgesReturnRun)
  const showConfirm = useStore((s) => s.showConfirm)
  const pushToast = useStore((s) => s.pushToast)

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

  const continueLevel = () => {
    unlockAudio()
    playClick()
    if (badgesReturnRun) {
      setScreen('level')
      return
    }
    setScreen('map')
  }

  const backToMap = () => {
    unlockAudio()
    playClick()
    if (!projectId || !badgesReturnRun) {
      setBadgesReturnRun(null)
      setScreen('map')
      return
    }

    showConfirm({
      title: '退出关卡',
      message: '关卡尚未完成。你可以保存断点后返回地图,也可以放弃本次关卡进度。',
      confirmText: '保存返回',
      secondaryText: '放弃进度',
      cancelText: '继续闯关',
      variant: 'warning',
      secondaryVariant: 'danger',
      onConfirm: () => {
        void api
          .saveLevelRun(projectId, badgesReturnRun)
          .then((nextProgress) => {
            setProgress(nextProgress)
            setBadgesReturnRun(null)
            pushToast('success', `已保存到第 ${badgesReturnRun.taskIndex + 1} 题`)
            setScreen('map')
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : '保存进度失败'
            const hint = message === '未找到' ? '保存接口未找到，请重启后端服务后再试' : message
            pushToast('error', `保存进度失败：${hint}`)
          })
      },
      onSecondary: () => {
        void api
          .discardLevelRun(projectId, badgesReturnRun.levelId)
          .then((nextProgress) => {
            setProgress(nextProgress)
            setBadgesReturnRun(null)
            setScreen('map')
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : '放弃进度失败'
            pushToast('error', `放弃进度失败：${message}`)
          })
      },
    })
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
        <div className="badges-actions">
          {badgesReturnRun && (
            <button type="button" className="nes-btn is-primary" onClick={continueLevel}>
              继续闯关
            </button>
          )}
          <button type="button" className="nes-btn badges-back" onClick={backToMap}>
            返回地图
          </button>
        </div>
      </main>
    </div>
  )
}
