import { useCallback, useEffect, useRef, useState } from 'react'
import type { Course, ProjectMeta } from '@code-quest/shared'
import * as api from '../api.js'
import { useStore } from '../store.js'

type GenStatus = ProjectMeta['generation']['status']

const STATUS_ICON: Record<string, string> = {
  pending: '·',
  generating: '◌',
  ready: '✓',
  failed: '✗',
  stale: '~',
  obsolete: '×',
}

export function Generating(): JSX.Element {
  const projectId = useStore((s) => s.projectId)
  const projectName = useStore((s) => s.projectName)
  const setScreen = useStore((s) => s.setScreen)
  const setCourse = useStore((s) => s.setCourse)
  const setProgress = useStore((s) => s.setProgress)

  const [course, setLocalCourse] = useState<Course | null>(null)
  const [status, setStatus] = useState<GenStatus>('idle')
  const [genError, setGenError] = useState<string | null>(null)
  const [failed, setFailed] = useState<Record<string, string>>({})
  const [retrying, setRetrying] = useState(false)

  // 保存最新一次拉取的 course/progress,完成时一次性写入全局并跳转
  const latest = useRef<{ course: Course | null; progress: ReturnType<typeof useStore.getState>['progress'] } | null>(
    null,
  )

  const refetch = useCallback(async () => {
    if (!projectId) return
    try {
      const { meta, course: c, progress } = await api.getProject(projectId)
      latest.current = { course: c, progress }
      setLocalCourse(c)
      setStatus(meta.generation.status)
      if (meta.generation.error) setGenError(meta.generation.error)
    } catch {
      // 单次拉取失败忽略,等下一次轮询/事件
    }
  }, [projectId])

  // 初始拉取 + SSE 订阅
  useEffect(() => {
    if (!projectId) return
    let alive = true

    void refetch()

    const unsubscribe = api.subscribeEvents(projectId, (e) => {
      if (!alive) return
      switch (e.type) {
        case 'course':
        case 'level':
        case 'done':
        case 'error':
          void refetch()
          break
        case 'level-failed':
          if (e.levelId) setFailed((f) => ({ ...f, [e.levelId as string]: e.error ?? '生成失败' }))
          void refetch()
          break
      }
    })

    // 轮询兜底:SSE 可能错过事件(完成后连入只收到 done)
    const poll = setInterval(() => {
      void (async () => {
        if (!projectId) return
        try {
          const { meta } = await api.getProject(projectId)
          if (meta.generation.status === 'done' || meta.generation.status === 'error') {
            await refetch()
          }
        } catch {
          /* ignore */
        }
      })()
    }, 2000)

    return () => {
      alive = false
      unsubscribe()
      clearInterval(poll)
    }
  }, [projectId, refetch])

  const proceed = useCallback(() => {
    const snap = latest.current
    if (snap) {
      setCourse(snap.course)
      setProgress(snap.progress)
    }
    setScreen('map')
  }, [setCourse, setProgress, setScreen])

  // 完成且无失败关卡时自动进入地图;有失败关卡则停留让玩家选择
  const failedLevelIds = course
    ? course.chapters.flatMap((ch) => ch.levels.filter((l) => l.status === 'failed').map((l) => l.id))
    : []

  useEffect(() => {
    if (status === 'done' && failedLevelIds.length === 0) {
      proceed()
    }
  }, [status, failedLevelIds.length, proceed])

  async function retry(): Promise<void> {
    if (!projectId || retrying) return
    setRetrying(true)
    setGenError(null)
    setFailed({})
    try {
      await api.regenerate(projectId)
      setStatus('generating')
      await refetch()
    } catch (err) {
      setGenError((err as Error).message)
    } finally {
      setRetrying(false)
    }
  }

  return (
    <main className="gen">
      <div className="gen-hero">
        <h1 className="gen-title blink">世界生成中…</h1>
        <p className="gen-subtitle">{projectName || '未知项目'}</p>
      </div>

      {status === 'error' ? (
        <section className="nes-container is-rounded is-error gen-status" role="alert">
          <p>世界生成出错了。</p>
          {genError && <p className="gen-error-msg">{genError}</p>}
          <button
            type="button"
            className={`nes-btn ${retrying ? 'is-disabled' : 'is-warning'}`}
            disabled={retrying}
            onClick={() => void retry()}
          >
            {retrying ? '重试中…' : '重试'}
          </button>
        </section>
      ) : !course ? (
        <section className="nes-container is-dark gen-status">
          <p className="blink">正在测绘世界地图…</p>
        </section>
      ) : (
        <section className="nes-container is-dark with-title gen-status">
          <p className="title">{course.projectName}</p>
          <p className="gen-tagline">{course.tagline}</p>
          <div className="gen-chapters">
            {course.chapters.map((ch) => (
              <div key={ch.id} className="gen-chapter">
                <h2 className="gen-chapter-title">{ch.title}</h2>
                <ul className="gen-level-list">
                  {ch.levels.map((lv) => (
                    <li key={lv.id} className={`gen-level gen-level--${lv.status}`}>
                      <span className="gen-level-icon">{STATUS_ICON[lv.status] ?? '·'}</span>
                      <span className="gen-level-title">{lv.title}</span>
                      {lv.status === 'failed' && (
                        <span className="gen-level-note">
                          ⚠ {failed[lv.id] ?? '生成失败,可稍后重试'}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {status === 'done' && failedLevelIds.length > 0 && (
        <section className="nes-container is-rounded is-warning gen-done-actions">
          <p>
            有 {failedLevelIds.length} 个关卡生成失败,可继续进入地图(失败关卡显示为 ⚠),或重试它们。
          </p>
          <div className="gen-actions-row">
            <button
              type="button"
              className={`nes-btn ${retrying ? 'is-disabled' : 'is-error'}`}
              disabled={retrying}
              onClick={() => void retry()}
            >
              {retrying ? '重试中…' : '重试失败关卡'}
            </button>
            <button type="button" className="nes-btn is-primary" onClick={proceed}>
              进入地图
            </button>
          </div>
        </section>
      )}
    </main>
  )
}
