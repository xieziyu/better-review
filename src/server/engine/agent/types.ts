import type { ChildProcess } from 'node:child_process'

import type { AgentKind } from '../../../shared/types'

export type { AgentKind }

export interface AgentSpawnArgs {
  executable: string
  prompt: string
  workdir: string
  logPath: string
  // Source tree the agent reads while reviewing. May be a full git worktree
  // checked out at the PR head SHA, or a partial snapshot of diff-touched
  // files at the same SHA. When set, claude runs with cwd=sourcePath; codex
  // runs with `-C <sourcePath>` and a read-only sandbox plus `--add-dir` for
  // the writable workdir. When omitted, agents fall back to no source
  // access beyond the diff.
  sourcePath?: string
  // Called whenever the agent emits a heartbeat (stream-json event for claude,
  // stdout line for codex). Each call resets the runner's stall watchdog.
  onProgress: (phase: string, detail?: string) => void
  // Called with one already-formatted human-readable transcript line per
  // agent emission, for live streaming to the UI. Independent of onProgress
  // so the watchdog stays driven by raw heartbeats while the transcript can
  // selectively skip noisy/empty events.
  onOutput?: (chunk: string) => void
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
  // Reconstruct human-readable transcript lines from a persisted agent.log.
  // The counterpart to live onOutput: same per-line shape, sourced from disk
  // after the run. Input is the raw log text (already tail-truncated by the
  // caller). Lines that don't map to transcript output are dropped.
  parseLog(raw: string): string[]
}
