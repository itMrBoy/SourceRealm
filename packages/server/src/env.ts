import { promises as fs } from 'node:fs'

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const SOURCEREALM_ENV_KEYS = new Set(['PORT', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY'])

function shouldLoadKey(key: string): boolean {
  return SOURCEREALM_ENV_KEYS.has(key) || key.startsWith('SOURCEREALM_')
}

export function parseEnvFile(raw: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const assignment = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trimStart() : trimmed
    const index = assignment.indexOf('=')
    if (index <= 0) continue

    const key = assignment.slice(0, index).trim()
    if (!ENV_KEY_RE.test(key)) continue

    const rawValue = assignment.slice(index + 1).trim()
    env[key] = unquoteValue(rawValue)
  }
  return env
}

function unquoteValue(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\"/g, '"')
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1)
  }
  const hash = value.indexOf(' #')
  return hash >= 0 ? value.slice(0, hash).trimEnd() : value
}

export async function loadRepoEnv(file: string): Promise<void> {
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }

  for (const [key, value] of Object.entries(parseEnvFile(raw))) {
    if (shouldLoadKey(key)) process.env[key] = value
  }
}
