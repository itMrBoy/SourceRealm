import { useEffect, useState } from 'react'
import type { ProjectMeta } from '@sourcerealm/shared'
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

type ProviderStatus = {
  mode?: 'claude-cli' | 'anthropic-api' | 'unset'
  available: boolean
  name?: string
  error?: string
  apiBaseUrl?: string
  apiBaseUrlSource?: 'env' | 'default'
}

function providerName(provider: ProviderStatus): string {
  if (provider.name === 'claude-cli') return 'Claude Code CLI'
  if (provider.name === 'anthropic-api') return 'Anthropic API'
  return provider.name ?? (provider.mode === 'anthropic-api' ? 'Anthropic API' : provider.mode ?? '未知')
}

function isApiProvider(provider: ProviderStatus): boolean {
  return provider.mode === 'anthropic-api' || provider.name === 'anthropic-api'
}

export function Home(): JSX.Element {
  const setScreen = useStore((s) => s.setScreen)
  const setProject = useStore((s) => s.setProject)
  const setCourse = useStore((s) => s.setCourse)
  const setProgress = useStore((s) => s.setProgress)
  const pushToast = useStore((s) => s.pushToast)

  const [projects, setProjects] = useState<ProjectMeta[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [path, setPath] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [provider, setProvider] = useState<ProviderStatus | null>(null)

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
        if (!alive) return
        setProvider(p)
        if (!p.available) {
          pushToast('warning', p.error ?? '未检测到可用 AI,请先完成配置')
        }
      })
      .catch(() => {
        /* Provider 探测失败不阻断界面 */
      })
    return () => {
      alive = false
    }
  }, [pushToast])

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
    // provider 未就绪时拦截:用 toast 提示去配置,不发起导入(避免后端生成必然失败)
    if (provider && !provider.available) {
      pushToast('warning', provider.error ?? '请先配置 AI 引擎再开始冒险')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const { id, name } = await api.importProject(trimmed)
      setProject(id, name)
      setScreen('generating')
    } catch (err) {
      const message = (err as Error).message
      setError(message)
      pushToast('error', `导入失败:${message}`)
    } finally {
      setSubmitting(false)
    }
  }

  async function chooseDirectory(): Promise<void> {
    if (picking || submitting) return
    setPicking(true)
    try {
      const selected = await api.pickDirectory()
      if (selected) {
        setPath(selected)
        pushToast('success', '已选择代码目录,确认后即可开始冒险')
      } else {
        pushToast('info', '已取消选择,也可以继续手动输入路径')
      }
    } catch (err) {
      pushToast('warning', `无法打开目录选择器:${(err as Error).message};可继续手动输入路径`)
    } finally {
      setPicking(false)
    }
  }

  return (
    <main className="home">
      <div className="home-hero">
        <h1 className="home-title">源界 SourceRealm</h1>
        <p className="home-subtitle blink">每个仓库,都是一个待探索的世界</p>
      </div>

      <section className="nes-container is-dark with-title home-new">
        <p className="title">新游戏</p>
        <p className="home-hint">输入本地仓库路径,开启一段源码冒险。</p>
        {provider && (
          <div className={`home-provider ${provider.available ? '' : 'home-provider--missing'}`}>
            <p>
              {provider.available
                ? `🤖 AI 引擎:${providerName(provider)}`
                : `⚠ 未检测到可用 AI:${provider.error ?? '请安装 Claude Code CLI 或设置 ANTHROPIC_API_KEY'}`}
            </p>
            {isApiProvider(provider) && provider.apiBaseUrl && (
              <p className="home-provider-sub">
                订阅/API 地址:{provider.apiBaseUrl}
                {provider.apiBaseUrlSource === 'default' ? '（默认）' : ''}
              </p>
            )}
          </div>
        )}
        <div className="nes-field home-field">
          <label htmlFor="repo-path">仓库路径</label>
          <div className="home-path-row">
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
            <button
              type="button"
              className="nes-btn home-pick-btn"
              disabled={submitting || picking}
              onClick={() => void chooseDirectory()}
            >
              {picking ? '选择中…' : '选择目录'}
            </button>
          </div>
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
