import type { Course, Level, Progress, ProjectMeta, LevelResult, SavedRun } from '@sourcerealm/shared'

const BASE = trimTrailingSlash(import.meta.env.VITE_SOURCEREALM_API_BASE ?? '/api')
const EVENTS_BASE = trimTrailingSlash(import.meta.env.VITE_SOURCEREALM_EVENTS_BASE ?? BASE)

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function joinUrl(base: string, path: string): string {
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

function apiUrl(path: string): string {
  return joinUrl(BASE, path)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (!res.ok) {
    let message = `请求失败 (${res.status})`
    try {
      const body = (await res.json()) as { error?: string; message?: string }
      message = body.error ?? body.message ?? message
    } catch {
      // 非 JSON 错误体,保留默认消息
    }
    throw new Error(message)
  }
  return (await res.json()) as T
}

export async function pickDirectory(): Promise<string | null> {
  const data = await request<{ path: string | null }>('/system/pick-directory', { method: 'POST' })
  return data.path
}

export async function importProject(path: string): Promise<{ id: string; name: string }> {
  return request('/projects', {
    method: 'POST',
    body: JSON.stringify({ path }),
  })
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const data = await request<{ projects: ProjectMeta[] }>('/projects')
  return data.projects
}

export async function getProvider(): Promise<{
  mode?: 'claude-cli' | 'anthropic-api' | 'unset'
  available: boolean
  name?: string
  error?: string
  apiBaseUrl?: string
  apiBaseUrlSource?: 'env' | 'default'
}> {
  return request('/provider')
}

export async function getProject(
  id: string,
): Promise<{ meta: ProjectMeta; course: Course | null; progress: Progress }> {
  return request(`/projects/${id}`)
}

export async function regenerate(id: string): Promise<void> {
  await request(`/projects/${id}/generate`, { method: 'POST' })
}

export async function updateCheck(id: string): Promise<{
  changed: boolean
  reason?: string
  anchor?: string | null
  head?: string | null
  summary?: { modified: number; deleted: number; added: number }
}> {
  return request(`/projects/${id}/update-check`)
}

export async function runUpdate(id: string): Promise<void> {
  await request(`/projects/${id}/update`, { method: 'POST' })
}

export async function getLevel(
  id: string,
  levelId: string,
): Promise<{ level: Level; freshness: Record<string, boolean> }> {
  return request(`/projects/${id}/levels/${levelId}`)
}

export async function getFile(id: string, path: string): Promise<string> {
  const data = await request<{ content: string }>(
    `/projects/${id}/file?path=${encodeURIComponent(path)}`,
  )
  return data.content
}

export async function getTree(id: string): Promise<string[]> {
  const data = await request<{ files: string[] }>(`/projects/${id}/tree`)
  return data.files
}

export async function submitLevel(
  id: string,
  body: { levelId: string; result: LevelResult; taskCount: number },
): Promise<{ progress: Progress; newBadges: string[] }> {
  return request(`/projects/${id}/progress/level`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function saveLevelRun(id: string, run: SavedRun): Promise<Progress> {
  const data = await request<{ progress: Progress }>(`/projects/${id}/progress/level-run`, {
    method: 'PUT',
    body: JSON.stringify(run),
  })
  return data.progress
}

export async function discardLevelRun(id: string, levelId: string): Promise<Progress> {
  const data = await request<{ progress: Progress }>(
    `/projects/${id}/progress/level-run/${encodeURIComponent(levelId)}`,
    { method: 'DELETE' },
  )
  return data.progress
}

export function saveLevelRunBestEffort(id: string, run: SavedRun): void {
  const body = JSON.stringify(run)
  const url = apiUrl(`/projects/${id}/progress/level-run`)
  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' })
    if (navigator.sendBeacon(url, blob)) return
  }
  void fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => undefined)
}

export async function markFileRead(id: string, file: string): Promise<Progress> {
  const data = await request<{ progress: Progress }>(`/projects/${id}/progress/file-read`, {
    method: 'POST',
    body: JSON.stringify({ file }),
  })
  return data.progress
}

export function subscribeEvents(
  id: string,
  onEvent: (e: { type: string; levelId?: string; error?: string }) => void,
): () => void {
  const source = new EventSource(joinUrl(EVENTS_BASE, `/projects/${id}/events`))
  source.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data))
    } catch {
      // 忽略无法解析的事件
    }
  }
  return () => source.close()
}
