import { useStore } from '../store.js'
import * as api from '../api.js'
import { useRun } from '../game/run.js'

export function GlobalControls(): JSX.Element {
  const screen = useStore((s) => s.screen)
  const projectId = useStore((s) => s.projectId)
  const badgesReturnRun = useStore((s) => s.badgesReturnRun)
  const badgeCount = useStore((s) => s.progress.badges.length)
  const muted = useStore((s) => s.muted)
  const crt = useStore((s) => s.crt)
  const setScreen = useStore((s) => s.setScreen)
  const setProgress = useStore((s) => s.setProgress)
  const setBadgesReturnRun = useStore((s) => s.setBadgesReturnRun)
  const showConfirm = useStore((s) => s.showConfirm)
  const pushToast = useStore((s) => s.pushToast)
  const toggleMuted = useStore((s) => s.toggleMuted)
  const toggleCrt = useStore((s) => s.toggleCrt)

  const goHome = () => {
    const run = screen === 'level' ? useRun.getState().snapshot() : screen === 'badges' ? badgesReturnRun : null
    if (!projectId || !run) {
      setBadgesReturnRun(null)
      setScreen('home')
      return
    }

    showConfirm({
      title: '退出关卡',
      message: '关卡尚未完成。你可以保存断点后离开,也可以放弃本次关卡进度。',
      confirmText: '保存离开',
      secondaryText: '放弃进度',
      cancelText: '继续闯关',
      variant: 'warning',
      secondaryVariant: 'danger',
      onConfirm: () => {
        void api
          .saveLevelRun(projectId, run)
          .then((progress) => {
            setProgress(progress)
            setBadgesReturnRun(null)
            pushToast('success', `已保存到第 ${run.taskIndex + 1} 题`)
            setScreen('home')
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : '保存进度失败'
            const hint = message === '未找到' ? '保存接口未找到，请重启后端服务后再试' : message
            pushToast('error', `保存进度失败：${hint}`)
          })
      },
      onSecondary: () => {
        void api
          .discardLevelRun(projectId, run.levelId)
          .then((progress) => {
            setProgress(progress)
            setBadgesReturnRun(null)
            setScreen('home')
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : '放弃进度失败'
            pushToast('error', `放弃进度失败：${message}`)
          })
      },
    })
  }

  const openBadges = () => {
    const run = screen === 'level' ? useRun.getState().snapshot() : null
    if (screen === 'level') setBadgesReturnRun(run)
    else if (screen !== 'badges') setBadgesReturnRun(null)
    setScreen('badges')
  }

  return (
    <nav className="global-controls" aria-label="全局控制">
      <button
        type="button"
        className="nes-btn global-control-btn"
        onClick={goHome}
        title="返回主菜单"
      >
        主菜单
      </button>
      <button
        type="button"
        className="nes-btn global-control-btn global-control-badges"
        onClick={openBadges}
        title="查看徽章"
      >
        ⭐ {badgeCount}
      </button>
      <button
        type="button"
        className={`nes-btn global-control-btn ${crt ? 'is-primary' : ''}`}
        onClick={toggleCrt}
        title="CRT 扫描线开关"
      >
        CRT {crt ? '开' : '关'}
      </button>
      <button
        type="button"
        className={`nes-btn global-control-btn ${muted ? 'is-error' : ''}`}
        onClick={toggleMuted}
        title="静音开关"
      >
        {muted ? '🔇' : '🔊'}
      </button>
    </nav>
  )
}
