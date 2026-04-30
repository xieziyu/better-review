import type { ChildProcess } from 'node:child_process'

import type { AgentKind } from '../../../shared/types'

export type { AgentKind }

export interface AgentSpawnArgs {
  executable: string
  prompt: string
  workdir: string
  logPath: string
  // Called whenever the agent emits a heartbeat (stream-json event for claude,
  // stdout line for codex). Each call resets the runner's stall watchdog.
  onProgress: (phase: string, detail?: string) => void
  // Called when the agent reports its main task has terminated (e.g. claude's
  // {type:"result"} stream-json event). Lets the runner finalise the session
  // even if the child process lingers afterwards waiting on background work.
  onResult?: (info: { ok: boolean }) => void
}

export interface AgentRunHandle {
  child: ChildProcess
  // Resolves when the agent's stdout stream has been fully consumed.
  drained: Promise<void>
}

export interface ReviewAgent {
  kind: AgentKind
  // Human-readable label used in UI / errors.
  displayName: string
  // Locate the binary on PATH. Returns null when the CLI is not installed.
  findExecutable(): string | null
  // Spawn one review run. Owns CLI flag construction and stdout parsing.
  spawn(args: AgentSpawnArgs): AgentRunHandle
}
