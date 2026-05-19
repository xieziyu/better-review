import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export interface Paths {
  home: string
  serverJson: string
  configFile: string
  dbFile: string
  sessionsDir: string
  promptsDir: string
  promptHome: string
  daemonLog: string
  daemonStderr: string
  // Isolated CODEX_HOME we pass to the codex CLI so its per-cwd trust_level
  // writes land here instead of polluting the user's real ~/.codex/config.toml.
  // See src/server/engine/agent/codex-home.ts for how it is bootstrapped.
  codexHome: string
}

export function resolvePaths(home?: string): Paths {
  const h = home ?? process.env.BETTER_REVIEW_HOME ?? join(homedir(), '.better-review')
  return {
    home: h,
    serverJson: join(h, 'server.json'),
    configFile: join(h, 'config.json'),
    dbFile: join(h, 'state.db'),
    sessionsDir: join(h, 'sessions'),
    promptsDir: join(h, 'prompts'),
    promptHome: join(h, 'review.md'),
    daemonLog: join(h, 'daemon.log'),
    daemonStderr: join(h, 'daemon-stderr.log'),
    codexHome: join(h, 'codex-home'),
  }
}

export function projectPromptPath(repoPath: string): string {
  return join(repoPath, '.better-review', 'review.md')
}

// Normalizes a user-supplied local-repo path: trims, expands a leading `~`,
// resolves to absolute, and asserts it points at an existing directory.
// Throws with a caller-facing message on any failure.
export function resolveLocalRepoPath(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0) throw new Error('localRepoPath must not be empty')
  const expanded =
    trimmed === '~' || trimmed.startsWith('~/') ? join(homedir(), trimmed.slice(1)) : trimmed
  const abs = resolve(expanded)
  if (!existsSync(abs)) throw new Error(`localRepoPath does not exist: ${abs}`)
  if (!statSync(abs).isDirectory()) throw new Error(`localRepoPath is not a directory: ${abs}`)
  return abs
}
