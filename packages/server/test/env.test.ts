import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadRepoEnv, parseEnvFile } from '../src/env.js'

describe('repo .env loader', () => {
  const saved = {
    baseUrl: process.env.ANTHROPIC_BASE_URL,
    apiKey: process.env.ANTHROPIC_API_KEY,
    home: process.env.SOURCEREALM_HOME,
    unrelated: process.env.UNRELATED_ENV_FOR_TEST,
  }

  afterEach(() => {
    restoreEnv('ANTHROPIC_BASE_URL', saved.baseUrl)
    restoreEnv('ANTHROPIC_API_KEY', saved.apiKey)
    restoreEnv('SOURCEREALM_HOME', saved.home)
    restoreEnv('UNRELATED_ENV_FOR_TEST', saved.unrelated)
  })

  it('解析常见 KEY=VALUE 格式', () => {
    expect(parseEnvFile([
      '# comment',
      'PORT=4977',
      'ANTHROPIC_BASE_URL=https://relay.example.com',
      'SOURCEREALM_HOME=',
      'export SOURCEREALM_MODEL="gpt-5.5"',
      "ANTHROPIC_API_KEY='secret'",
    ].join('\n'))).toEqual({
      PORT: '4977',
      ANTHROPIC_BASE_URL: 'https://relay.example.com',
      SOURCEREALM_HOME: '',
      SOURCEREALM_MODEL: 'gpt-5.5',
      ANTHROPIC_API_KEY: 'secret',
    })
  })

  it('仓库 .env 覆盖外部同名 SourceRealm/Anthropic 变量', async () => {
    process.env.ANTHROPIC_BASE_URL = 'https://user-env.example.com'
    process.env.UNRELATED_ENV_FOR_TEST = 'keep'
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sr-env-'))
    const file = path.join(dir, '.env')
    await fs.writeFile(file, [
      'ANTHROPIC_BASE_URL=https://repo-env.example.com',
      'SOURCEREALM_HOME=',
      'UNRELATED_ENV_FOR_TEST=changed',
    ].join('\n'))

    await loadRepoEnv(file)

    expect(process.env.ANTHROPIC_BASE_URL).toBe('https://repo-env.example.com')
    expect(process.env.SOURCEREALM_HOME).toBe('')
    expect(process.env.UNRELATED_ENV_FOR_TEST).toBe('keep')
  })
})

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}
