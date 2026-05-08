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
    const { executable, prompt, workdir, localRepoPath, logPath, onProgress, onOutput } = args
    // Prompt is fed via stdin to avoid argv length limits with large diffs.
    // Two modes:
    // - No localRepoPath (legacy): cwd=workdir + workspace-write so the agent
    //   can write findings.json there; skip-git-repo-check because workdir is
    //   not a git repo.
    // - With localRepoPath: keep cwd=workdir, but tell codex its working root
    //   is the local clone via -C, lock the sandbox to read-only so it can
    //   read source freely without mutating it, and whitelist workdir via
    //   --add-dir so findings.json writes still succeed.
    const codexArgs = localRepoPath
      ? [
          'exec',
          '-C',
          localRepoPath,
          '--sandbox',
          'read-only',
          '--add-dir',
          workdir,
          '--color',
          'never',
          '-',
        ]
      : ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', '--color', 'never', '-']
    const child = spawn(executable, codexArgs, {
      cwd: workdir,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    if (child.stdin) {
      child.stdin.end(prompt)
    }

    // codex 0.125+ writes the live progress (banner, prompt echo, reasoning,
    // tool calls / exec output) to stderr and only the final answer to stdout.
    // Treat both streams as line-oriented transcript — onOutput sees the
    // interesting stderr lines too, and the watchdog gets fed regardless of
    // which pipe the agent is currently writing to.
    const handleLine = (line: string) => {
      onProgress('output', line.slice(0, 200))
      appendFileSync(logPath, line + '\n')
      onOutput?.(line)
    }
    const stdoutDone = consumeLines(child.stdout!, handleLine)
    const stderrDone = child.stderr ? consumeLines(child.stderr, handleLine) : Promise.resolve()
    const drained = Promise.all([stdoutDone, stderrDone]).then(() => undefined)

    return { child, drained }
  }
}
