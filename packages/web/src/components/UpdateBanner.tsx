import { useState } from 'react'
import * as api from '../api.js'
import { useStore } from '../store.js'

/**
 * 「世界发生了变化!」公告条。仅当 update-check 返回 changed 时由 MapScreen 渲染。
 * 「更新关卡」:记录更新前锚点(updateBaseline),POST /update,跳转进度屏复用。
 * 「稍后再说」:本次访问内隐藏(由 MapScreen 维护 dismissed 状态)。
 */
export function UpdateBanner({
  anchor,
  summary,
  onDismiss,
}: {
  anchor: string | null | undefined
  summary?: { modified: number; deleted: number; added: number }
  onDismiss: () => void
}): JSX.Element {
  const projectId = useStore((s) => s.projectId)
  const setScreen = useStore((s) => s.setScreen)
  const setUpdateBaseline = useStore((s) => s.setUpdateBaseline)
  const [starting, setStarting] = useState(false)

  const m = summary?.modified ?? 0
  const d = summary?.deleted ?? 0
  const a = summary?.added ?? 0

  async function startUpdate(): Promise<void> {
    if (!projectId || starting) return
    setStarting(true)
    try {
      // 记录更新前锚点:进度屏据此区分「初次生成完成」与「更新尚未开始的旧 done」
      setUpdateBaseline(anchor ?? null)
      await api.runUpdate(projectId)
      setScreen('generating')
    } catch {
      setUpdateBaseline(null)
      setStarting(false)
    }
  }

  return (
    <section className="nes-container is-warning update-banner" role="alert">
      <p className="update-banner-text">
        ⚡ 世界发生了变化!仓库有 {m} 处修改 / {d} 处删除 / {a} 处新增
      </p>
      <div className="update-banner-actions">
        <button
          type="button"
          className={`nes-btn ${starting ? 'is-disabled' : 'is-primary'}`}
          disabled={starting}
          onClick={() => void startUpdate()}
        >
          {starting ? '更新中…' : '更新关卡'}
        </button>
        <button type="button" className="nes-btn" disabled={starting} onClick={onDismiss}>
          稍后再说
        </button>
      </div>
    </section>
  )
}
