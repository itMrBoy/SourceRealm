import type { ToastType } from '../store.js'
import { useStore } from '../store.js'

/** toast 类型 → nes.css 容器修饰类 */
const TOAST_CLASS: Record<ToastType, string> = {
  info: 'is-primary',
  success: 'is-success',
  warning: 'is-warning',
  error: 'is-error',
}

const TOAST_ICON: Record<ToastType, string> = {
  info: 'ℹ',
  success: '✓',
  warning: '⚠',
  error: '✕',
}

/** 全局浮层:渲染 toast 队列。挂在 App 顶层,覆盖所有 screen。 */
export function ToastContainer(): JSX.Element {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`nes-container is-rounded ${TOAST_CLASS[t.type]} toast-item`}
          onClick={() => dismiss(t.id)}
        >
          <span className="toast-icon">{TOAST_ICON[t.type]}</span>
          <span className="toast-text">{t.text}</span>
        </div>
      ))}
    </div>
  )
}
