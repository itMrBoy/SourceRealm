import { execa } from 'execa'
import { resolveClaudeBin } from '../claude-path.js'
import { extractJson } from '../json.js'
import { buildClaudeCliPrompt, buildCliEnv } from '../prompt.js'
import { ProviderError, type GenerateOptions, type LLMProvider } from '../types.js'

/** CLI 子进程超时(ms):自主探索较耗时,留足余量 */
const CLI_TIMEOUT_MS = 900_000

/** claude CLI provider:让 claude 在仓库目录内自主探索(只读),产出结构化 JSON */
export class ClaudeCliProvider implements LLMProvider {
  readonly name = 'claude-cli'

  static async available(): Promise<boolean> {
    return execa(resolveClaudeBin(), ['--version'], { timeout: 10_000 }).then(
      () => true,
      () => false,
    )
  }

  async generate<T>(opts: GenerateOptions<T>): Promise<T> {
    // 放行只读探索工具,禁止落盘/执行类工具(即便加载了项目 .claude/ 也不会写文件或跑命令)
    const args = [
      '-p',
      '--input-format',
      'text',
      '--output-format',
      'json',
      '--allowedTools',
      'Read,Glob,Grep',
      '--disallowedTools',
      'Write,Edit,Bash',
    ]
    const { stdout } = await execa(resolveClaudeBin(), args, {
      cwd: opts.cwd,
      timeout: CLI_TIMEOUT_MS,
      input: buildClaudeCliPrompt(opts),
      env: buildCliEnv(),
    })
    const envelope = JSON.parse(stdout) as { result?: string; is_error?: boolean }
    if (envelope.is_error || typeof envelope.result !== 'string') {
      throw new ProviderError(`claude CLI 调用失败: ${stdout.slice(0, 300)}`)
    }
    return opts.schema.parse(extractJson(envelope.result))
  }
}
