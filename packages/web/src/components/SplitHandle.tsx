import { useCallback } from 'react'

interface SplitHandleProps {
  /** 拖动中回调,参数为指针当前 clientX */
  onDrag: (clientX: number) => void
}

/** 可拖拽的纵向分隔条(列宽调整) */
export function SplitHandle({ onDrag }: SplitHandleProps): JSX.Element {
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const el = e.currentTarget
      el.setPointerCapture(e.pointerId)
      document.body.classList.add('col-resizing')

      const onMove = (ev: PointerEvent): void => onDrag(ev.clientX)
      const onUp = (): void => {
        el.removeEventListener('pointermove', onMove)
        el.removeEventListener('pointerup', onUp)
        document.body.classList.remove('col-resizing')
      }
      el.addEventListener('pointermove', onMove)
      el.addEventListener('pointerup', onUp)
    },
    [onDrag],
  )

  return (
    <div
      className="split-handle"
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
    />
  )
}
