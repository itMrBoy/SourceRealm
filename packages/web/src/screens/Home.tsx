import { useEffect, useState } from 'react'
import type { ProjectMeta } from '@code-quest/shared'
import * as api from '../api.js'
import { useStore } from '../store.js'

const STATUS_LABEL: Record<string, string> = {
  idle: '未开始',
  mapping: '测绘中',
  generating: '生成中',
  done: '可游玩',
  error: '生成失败',
}

const STATUS_CLASS: Record<string, string> = {
  done: 'is-success',
  error: 'is-error',
  mapping: 'is-warning',
  generating: 'is-warning',
  idle: 'is-dark',
}

export function Home(): JSX.Element {
  const setScreen = useStore((s) => s.setScreen)
  const setProject = useStore((s) => s.setProject)
  const setCourse = useStore((s) => s.setCourse)
  const setProgress = useStore((s) => s.setProgress)

  const [projects, setProjects] = useState<ProjectMeta[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [path, setPath] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [provider, setProvider] = useState<{ available: boolean; name?: string; error?: string } | null>(null)

  useEffect(() => {
    let alive = true
    api
      .listProjects()
      .then((list) => {
        if (alive) setProjects(list)
      })
      .catch(() => {
        /* 列表加载失败不阻断导入 */
      })
      .finally(() => {
        if (alive) setLoadingList(false)
      })
    api
      .getProvider()
      .then((p) => {
        if (alive) setProvider(p)
      })
      .catch(() => {
        /* Provider 探测失败不阻断界面 */
      })
    return () => {
      alive = false
    }
  }, [])

  async function openExisting(meta: ProjectMeta): Promise<void> {
    setProject(meta.id, meta.name)
    if (meta.generation.status === 'done') {
      try {
        const { course, progress } = await api.getProject(meta.id)
        setCourse(course)
        setProgress(progress)
        setScreen('map')
        return
      } catch {
        // 拉取失败则退回生成屏继续观察
      }
    }
    setScreen('generating')
  }

  async function startAdventure(): Promise<void> {
    const trimmed = path.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const { id, name } = await api.importProject(trimmed)
      setProject(id, name)
      setScreen('generating')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="home">
      <div className="home-hero">
        <h1 className="home-title">CodeQuest</h1>
        <p className="home-subtitle blink">源码闯关阅读器</p>
      </div>

      <section className="nes-container is-dark with-title home-new">
        <p className="title">新游戏</p>
        <p className="home-hint">输入本地仓库路径,开启一段源码冒险。</p>
        {provider && (
          <p className={`home-provider ${provider.available ? '' : 'home-provider--missing'}`}>
            {provider.available
              ? `🤖 AI 引擎:${provider.name === 'claude-cli' ? 'Claude Code CLI' : provider.name === 'anthropic-api' ? 'Anthropic API' : provider.name}`
              : `⚠ 未检测到可用 AI:${provider.error ?? '请安装 Claude Code CLI 或设置 ANTHROPIC_API_KEY'}`}
          </p>
        )}
        <div className="nes-field home-field">
          <label htmlFor="repo-path">仓库路径</label>
          <input
            id="repo-path"
            className="nes-input"
            type="text"
            placeholder="/path/to/your/repo"
            value={path}
            disabled={submitting}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void startAdventure()
            }}
          />
        </div>
        <button
          type="button"
          className={`nes-btn ${submitting || !path.trim() ? 'is-disabled' : 'is-primary'}`}
          disabled={submitting || !path.trim()}
          onClick={() => void startAdventure()}
        >
          {submitting ? '召唤世界中…' : '开始冒险!'}
        </button>

        {error && (
          <div className="nes-container is-rounded is-error home-error" role="alert">
            <p>导入失败:{error}</p>
          </div>
        )}
      </section>

      <section className="nes-container is-dark with-title home-load">
        <p className="title">继续冒险</p>
        {loadingList ? (
          <p className="home-hint blink">读取存档中…</p>
        ) : projects.length === 0 ? (
          <p className="home-hint">暂无存档,先开始一段新冒险吧。</p>
        ) : (
          <ul className="home-project-list">
            {projects.map((p) => {
              const status = p.generation.status
              return (
                <li key={p.id} className="home-project-item">
                  <button
                    type="button"
                    className="nes-btn home-project-btn"
                    onClick={() => void openExisting(p)}
                  >
                    <span className="home-project-name">{p.name}</span>
                    <span className={`nes-badge home-project-badge`}>
                      <span className={STATUS_CLASS[status] ?? 'is-dark'}>
                        {STATUS_LABEL[status] ?? status}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </main>
  )
}
