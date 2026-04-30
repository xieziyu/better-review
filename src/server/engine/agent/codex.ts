import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import type { Readable } from 'node:stream'

import type { AgentRunHandle, AgentSpawnArgs, ReviewAgent } from './types'
import { whichBinary } from './which'

async function consumeLines(stream: Readable, onLine: (line: string) => void): Promise<void> {
  let buf = ''
  for await (const chunk of stream) {
    buf += typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf8')
    let nl: number
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trimEnd()
      buf = buf.slice(nl + 1)
      if (line) onLine(line)
    }
  }
  const tail = buf.trimEnd()
  if (tail) onLine(tail)
}

export class CodexAgent implements ReviewAgent {
  readonly kind = 'codex' as const
  readonly displayName = 'codex'

  findExecutable(): string | null {
    return whichBinary('codex')
  }

  spawn(args: AgentSpawnArgs): AgentRunHandle {
    const { executable, prompt, workdir, logPath, onProgress, onOutput } = args
    // Prompt is fed via stdin to avoid argv length limits with large diffs.
    // workspace-write lets the agent write {{FINDINGS_PATH}} inside `workdir`;
    // skip-git-repo-check is needed because session workdirs are not git repos.
    const child = spawn(
      executable,
      ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', '--color', 'never', '-'],
      {
        cwd: workdir,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )

    if (child.stdin) {
      child.stdin.end(prompt)
    }

    const drained = consumeLines(child.stdout!, (line) => {
      onProgress('output', line.slice(0, 200))
      appendFileSync(logPath, line + '\n')
      onOutput?.(line)
    })

    child.stderr?.on('data', (chunk) => appendFileSync(logPath, chunk))

    return { child, drained }
  }
}
