import { useEffect } from 'react'
import { useStore } from '../store.js'

/** 全局确认框:替代浏览器原生 confirm,保持游戏内像素风交互。 */
export function ConfirmDialog(): JSX.Element | null {
  const dialog = useStore((s) => s.confirmDialog)
  const hideConfirm = useStore((s) => s.hideConfirm)

  useEffect(() => {
    if (!dialog) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hideConfirm()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dialog, hideConfirm])

  if (!dialog) return null

  const confirmText = dialog.confirmText ?? '确定'
  const cancelText = dialog.cancelText ?? '取消'
  const confirmClass = dialog.variant === 'danger' ? 'is-error' : 'is-warning'

  const onConfirm = () => {
    const action = dialog.onConfirm
    hideConfirm()
    action()
  }

  return (
    <div className="confirm-overlay" role="presentation">
      <div
        className="nes-container is-rounded is-dark confirm-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
      >
        <p id="confirm-title" className="confirm-title">
          {dialog.title}
        </p>
        <p id="confirm-message" className="confirm-message">
          {dialog.message}
        </p>
        <div className="confirm-actions">
          <button type="button" className={`nes-btn ${confirmClass}`} onClick={onConfirm} autoFocus>
            {confirmText}
          </button>
          <button type="button" className="nes-btn" onClick={hideConfirm}>
            {cancelText}
          </button>
        </div>
      </div>
    </div>
  )
}
