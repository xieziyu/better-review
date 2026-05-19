import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Codex CLI appends a `[projects."<cwd>"] trust_level = "trusted"` block to its
// config.toml every time it runs in a new cwd. better-review spawns codex with
// a fresh per-session workdir, so without intervention the user's real
// ~/.codex/config.toml grows one block per review. Upstream issues
// (openai/codex#14601, #15433) ask for separating trust state out of config.toml
// but no flag exists yet.
//
// Workaround: point codex at our own CODEX_HOME under ~/.better-review/. The
// codex CLI honors CODEX_HOME for both config and auth, so the trust writes
// land in a directory we own. We seed that directory with a copy of the user's
// config.toml (minus `[projects.*]` sections), and we symlink the user's
// auth.json if they use file-based credentials — keychain-based auth on macOS
// works without further setup because the keyring is shared.

const PROJECT_SECTION = /^\s*\[projects\.[^\]]+\]\s*$/
const ANY_SECTION = /^\s*\[[^\]]+\]\s*$/

// Drop every `[projects."..."]` table — header line plus its body — from a
// raw config.toml string. Other content (settings, comments, blank lines) is
// preserved verbatim so the user's hand-edited config carries over.
export function stripProjectSections(toml: string): string {
  const out: string[] = []
  let skipping = false
  for (const line of toml.split('\n')) {
    if (PROJECT_SECTION.test(line)) {
      skipping = true
      continue
    }
    if (skipping && ANY_SECTION.test(line)) {
      skipping = false
    }
    if (skipping) continue
    out.push(line)
  }
  return out.join('\n')
}

export interface PrepareCodexHomeOptions {
  // The destination CODEX_HOME directory we want codex to use. Created if missing.
  codexHome: string
  // The user's real ~/.codex (overridable for tests). Defaults to ~/.codex.
  userCodexHome?: string
}

interface SyncState {
  configMtimeMs: number | null
  authTarget: string | null
}

function readSyncState(stateFile: string): SyncState {
  if (!existsSync(stateFile)) return { configMtimeMs: null, authTarget: null }
  try {
    const parsed = JSON.parse(readFileSync(stateFile, 'utf8')) as Partial<SyncState>
    return {
      configMtimeMs: typeof parsed.configMtimeMs === 'number' ? parsed.configMtimeMs : null,
      authTarget: typeof parsed.authTarget === 'string' ? parsed.authTarget : null,
    }
  } catch {
    return { configMtimeMs: null, authTarget: null }
  }
}

function writeSyncState(stateFile: string, state: SyncState): void {
  writeFileSync(stateFile, JSON.stringify(state))
}

// Idempotent. Safe to call repeatedly; the second call is a no-op unless the
// user's ~/.codex/config.toml has changed since the last sync. Designed to be
// invoked just before codex spawn so a freshly-updated user config rolls
// through without requiring a daemon restart.
export function prepareCodexHome(opts: PrepareCodexHomeOptions): void {
  const userCodexHome = opts.userCodexHome ?? join(homedir(), '.codex')
  const dest = opts.codexHome
  mkdirSync(dest, { recursive: true })

  const stateFile = join(dest, '.better-review-sync.json')
  const state = readSyncState(stateFile)

  // 1. Sync config.toml (filter out [projects.*]). Resync only when the user's
  // source file mtime changes — codex writes its own trust entries into our
  // destination copy and we must not clobber those on every spawn.
  const userConfigPath = join(userCodexHome, 'config.toml')
  const destConfigPath = join(dest, 'config.toml')
  let nextConfigMtime: number | null = null
  if (existsSync(userConfigPath)) {
    nextConfigMtime = statSync(userConfigPath).mtimeMs
    const needResync = nextConfigMtime !== state.configMtimeMs || !existsSync(destConfigPath)
    if (needResync) {
      const raw = readFileSync(userConfigPath, 'utf8')
      writeFileSync(destConfigPath, stripProjectSections(raw))
    }
  } else if (!existsSync(destConfigPath)) {
    writeFileSync(destConfigPath, '')
  }

  // 2. Symlink auth.json if the user has one. Keychain users (default on macOS)
  // skip this branch and inherit credentials via the shared keyring.
  const userAuthPath = join(userCodexHome, 'auth.json')
  const destAuthPath = join(dest, 'auth.json')
  let nextAuthTarget: string | null = state.authTarget
  if (existsSync(userAuthPath)) {
    const currentLink = readExistingSymlinkTarget(destAuthPath)
    if (currentLink !== userAuthPath) {
      removeIfExists(destAuthPath)
      symlinkSync(userAuthPath, destAuthPath)
    }
    nextAuthTarget = userAuthPath
  } else {
    // User cleared their auth — drop a stale symlink so codex doesn't try to
    // dereference a dangling target.
    if (existsSync(destAuthPath) || isSymlink(destAuthPath)) {
      removeIfExists(destAuthPath)
    }
    nextAuthTarget = null
  }

  writeSyncState(stateFile, { configMtimeMs: nextConfigMtime, authTarget: nextAuthTarget })
}

function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink()
  } catch {
    return false
  }
}

function readExistingSymlinkTarget(p: string): string | null {
  if (!isSymlink(p)) return null
  try {
    return readlinkSync(p)
  } catch {
    return null
  }
}

function removeIfExists(p: string): void {
  try {
    unlinkSync(p)
  } catch {
    /* not present or already gone */
  }
}
