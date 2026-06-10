import { useState } from 'react'
import type { Chapter, LevelOutline } from '@code-quest/shared'
import * as api from '../api.js'
import { useStore } from '../store.js'
import { Hud } from '../components/Hud.js'

type NodeStatus = 'done' | 'current' | 'locked' | 'failed'

export function MapScreen(): JSX.Element {
  const course = useStore((s) => s.course)
  const progress = useStore((s) => s.progress)
  const projectId = useStore((s) => s.projectId)
  const openLevel = useStore((s) => s.openLevel)
  const setScreen = useStore((s) => s.setScreen)

  const [retrying, setRetrying] = useState<string | null>(null)

  if (!course) {
    return (
      <div className="map">
        <Hud />
        <main className="map-empty">
          <p className="blink">尚未生成课程地图。</p>
        </main>
      </div>
    )
  }

  // 全课程线性顺序(跳过 obsolete);第一个非 done 且 status==='ready' 的关卡为「当前关」。
  // 失败关卡不阻断进度:计算 current 时跳过非 ready 关卡。
  const linear: LevelOutline[] = course.chapters
    .flatMap((ch) => ch.levels)
    .filter((lv) => lv.status !== 'obsolete')

  let currentId: string | null = null
  for (const lv of linear) {
    if (progress.completedLevels[lv.id]) continue
    if (lv.status === 'ready') {
      currentId = lv.id
      break
    }
  }

  // 标记每个关卡的 UI 状态:
  // - 已有通关记录 → done(允许重玩)
  // - 生成失败 → failed(可重试,不阻断进度)
  // - 恰为当前关 → current
  // - 其余未通关卡 → locked(包括 current 之后、以及尚未 ready 的关卡)
  const statusOf = (lv: LevelOutline): NodeStatus => {
    if (progress.completedLevels[lv.id]) return 'done'
    if (lv.status === 'failed') return 'failed'
    if (lv.id === currentId) return 'current'
    return 'locked'
  }

  const allDone = linear.length > 0 && linear.every((lv) => progress.completedLevels[lv.id])

  async function retry(levelId: string): Promise<void> {
    if (!projectId || retrying) return
    setRetrying(levelId)
    try {
      await api.regenerate(projectId)
      setScreen('generating')
    } catch {
      setRetrying(null)
    }
  }

  // 全局线性索引,用于关卡编号与 locked 判定
  let runningIndex = 0

  return (
    <div className="map">
      <Hud />
      <main className="map-scroll">
        <div className="map-track">
          {course.chapters.map((ch, ci) => (
            <ChapterZone key={ch.id} chapter={ch} colorIndex={ci % 4}>
              {ch.levels
                .filter((lv) => lv.status !== 'obsolete')
                .map((lv) => {
                  const idx = runningIndex++
                  const st = statusOf(lv)
                  const completion = progress.completedLevels[lv.id]
                  return (
                    <LevelNode
                      key={lv.id}
                      level={lv}
                      order={idx + 1}
                      status={st}
                      rating={completion?.rating}
                      retrying={retrying === lv.id}
                      onPlay={() => openLevel(lv.id)}
                      onRetry={() => void retry(lv.id)}
                    />
                  )
                })}
            </ChapterZone>
          ))}

          {allDone && (
            <div className="map-cert-zone">
              <button
                type="button"
                className="nes-btn is-success map-cert-btn"
                onClick={() => setScreen('cert')}
              >
                🏆 领取通关证书
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

function ChapterZone({
  chapter,
  colorIndex,
  children,
}: {
  chapter: Chapter
  colorIndex: number
  children: React.ReactNode
}): JSX.Element {
  return (
    <section className={`map-chapter map-chapter--c${colorIndex}`}>
      <div className="map-chapter-head">
        <h2 className="map-chapter-title">{chapter.title}</h2>
        <p className="map-chapter-intro">{chapter.intro}</p>
      </div>
      <div className="map-nodes">{children}</div>
    </section>
  )
}

function LevelNode({
  level,
  order,
  status,
  rating,
  retrying,
  onPlay,
  onRetry,
}: {
  level: LevelOutline
  order: number
  status: NodeStatus
  rating?: string
  retrying: boolean
  onPlay: () => void
  onRetry: () => void
}): JSX.Element {
  if (status === 'locked') {
    return (
      <div className="map-node-wrap">
        <button type="button" className="map-node node-locked" disabled title={level.title}>
          <span className="node-icon">🔒</span>
        </button>
        <span className="node-order">#{order}</span>
        <span className="node-label">{level.title}</span>
      </div>
    )
  }

  if (status === 'failed') {
    return (
      <div className="map-node-wrap">
        <button
          type="button"
          className="map-node node-failed"
          onClick={onRetry}
          disabled={retrying}
          title={`生成失败 — 点击重试:${level.title}`}
        >
          <span className="node-icon">{retrying ? '…' : '⚠'}</span>
        </button>
        <span className="node-order">#{order}</span>
        <span className="node-label">{retrying ? '重试中…' : `${level.title} · 重试`}</span>
      </div>
    )
  }

  if (status === 'done') {
    return (
      <div className="map-node-wrap">
        <button
          type="button"
          className="map-node node-done"
          onClick={onPlay}
          title={`已通关(${rating ?? '?'})— 点击重玩:${level.title}`}
        >
          <span className="node-icon">✓</span>
          {rating && <span className="node-rating">{rating}</span>}
        </button>
        <span className="node-order">#{order}</span>
        <span className="node-label">{level.title}</span>
      </div>
    )
  }

  // current
  return (
    <div className="map-node-wrap">
      <button
        type="button"
        className="map-node node-current"
        onClick={onPlay}
        title={`开始挑战:${level.title}`}
      >
        <span className="node-icon blink">▶</span>
      </button>
      <span className="node-order">#{order}</span>
      <span className="node-label node-label--current">{level.title}</span>
    </div>
  )
}
