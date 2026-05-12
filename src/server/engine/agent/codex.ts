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
    const { executable, prompt, workdir, sourcePath, logPath, onProgress, onOutput } = args
    // Prompt is fed via stdin to avoid argv length limits with large diffs.
    // Two modes:
    // - No sourcePath (diff-only): cwd=workdir + workspace-write so the
    //   agent can write findings.json there.
    // - With sourcePath (worktree at PR head, or per-session source snapshot):
    //   keep cwd=workdir, do NOT pass -C, and expose the source tree via
    //   --add-dir sourcePath. Codex enforces TWO independent boundaries on
    //   writes: the OS sandbox (controlled by --sandbox + --add-dir) and
    //   apply_patch's "project root" check (anchored at -C, defaulting to
    //   cwd). Earlier we tried -C sourcePath + --add-dir workdir, which
    //   made workdir a writable OS-sandbox root but apply_patch still
    //   rejected findings.json with "writing outside of the project"
    //   because workdir was the parent of the project root. Rooting
    //   codex at workdir (no -C) clears both checks for findings writes.
    //   The agent must use absolute paths or `cd` to navigate sourcePath;
    //   the prompt already provides its absolute path. The source tree
    //   being writable in theory is fine: it is a disposable session-owned
    //   worktree under ~/.better-review/sessions/<id>/, and the prompt
    //   instructs the agent not to modify it.
    // `--skip-git-repo-check` is required in BOTH modes: the diff-only
    // workdir is not a git repo at all, and the source dir (whether snapshot
    // or worktree) lives under our managed `~/.better-review/sessions/...`
    // path which codex won't auto-trust. The flag only disables the trust
    // prompt; it does not relax sandboxing.
    const codexArgs = sourcePath
      ? [
          'exec',
          '--sandbox',
          'workspace-write',
          '--add-dir',
          sourcePath,
          '--skip-git-repo-check',
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
