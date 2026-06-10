import type { Course, Level, Progress, ProjectMeta, LevelResult } from '@code-quest/shared'

const BASE = '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
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

export async function getProvider(): Promise<{ available: boolean; name?: string; error?: string }> {
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
  const source = new EventSource(`${BASE}/projects/${id}/events`)
  source.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data))
    } catch {
      // 忽略无法解析的事件
    }
  }
  return () => source.close()
}
