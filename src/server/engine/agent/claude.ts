import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'

import { parseStreamJson } from '../stream-json'
import type { AgentRunHandle, AgentSpawnArgs, ReviewAgent } from './types'
import { whichBinary } from './which'

export class ClaudeAgent implements ReviewAgent {
  readonly kind = 'claude' as const
  readonly displayName = 'claude'

  findExecutable(): string | null {
    return whichBinary('claude')
  }

  spawn(args: AgentSpawnArgs): AgentRunHandle {
    const { executable, prompt, workdir, logPath, onProgress } = args
    const child = spawn(executable, ['--output-format', 'stream-json', '--verbose', '-p', prompt], {
      cwd: workdir,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const drained = parseStreamJson(
      child.stdout!,
      (e) => {
        const detail = JSON.stringify(e).slice(0, 200)
        onProgress(e.type, detail)
        appendFileSync(logPath, JSON.stringify(e) + '\n')
      },
      (err) => appendFileSync(logPath, `[stream-json error] ${err}\n`),
    )

    child.stderr?.on('data', (chunk) => appendFileSync(logPath, chunk))

    return { child, drained }
  }
}
