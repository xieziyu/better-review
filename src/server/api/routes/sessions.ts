import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

import { Hono } from 'hono'

import { AGENT_KINDS, type AgentKind, type PrepCall, type PrepStep } from '../../../shared/types'
import { getAgent } from '../../engine/agent'
import { diffTouchedPaths, snapshotDirFor } from '../../git/snapshot'
import { worktreeDirFor } from '../../git/worktree'
import { parseSessionInput } from '../../source/parse'
import type { AppDeps } from '../app'

function isAgentKind(value: unknown): value is AgentKind {
  return typeof value === 'string' && (AGENT_KINDS as readonly string[]).includes(value)
}

// Cap how much of agent.log we replay into a completed session's transcript.
// stream-json logs can run to MBs; the tail is what's worth showing.
const TRANSCRIPT_TAIL_LINES = 2000

// Cap how many gh-call entries we replay from prep.log. Each call carries the
// full untruncated stdout/stderr; a misbehaving session with hundreds of
// paginated `gh api` calls would otherwise serialize a multi-MB JSON body.
// Phase markers are never dropped — only `kind:'call'` entries get tail-capped.
const PREP_LOG_TAIL_CALLS = 200

export function sessionsRoutes(deps: AppDeps): Hono {
  const r = new Hono()
  r.get('/sessions', (c) => c.json(deps.sessions.list()))
  r.post('/sessions', async (c) => {
    const body = await c.req.json<{
      prInput: string
      agent?: unknown
      localRepoPath?: unknown
      extraPrompt?: unknown
      // Optional hints used only when prInput parses as a local-branch
      // source; ignored for GitHub PR URLs. The Home UI populates these
      // in Phase 1d; the API accepts them now so external callers can
      // already drive local-branch reviews.
      localBranchHead?: unknown
      localBranchBase?: unknown
      // When set with a path-shaped prInput, switches the source kind
      // to gitbutler-vbranch. The flow resolves the vbranch's tip+base
      // via `but status` at runtime — see source/gitbutler-vbranch-flow.
      vbranchName?: unknown
    }>()
    if (!body?.prInput) return c.json({ error: 'prInput required' }, 400)
    if (body.agent !== undefined && !isAgentKind(body.agent)) {
      return c.json({ error: `unknown agent: ${String(body.agent)}` }, 400)
    }
    if (body.localRepoPath !== undefined && typeof body.localRepoPath !== 'string') {
      return c.json({ error: 'localRepoPath must be a string' }, 400)
    }
    if (body.extraPrompt !== undefined && typeof body.extraPrompt !== 'string') {
      return c.json({ error: 'extraPrompt must be a string' }, 400)
    }
    if (body.localBranchHead !== undefined && typeof body.localBranchHead !== 'string') {
      return c.json({ error: 'localBranchHead must be a string' }, 400)
    }
    if (body.localBranchBase !== undefined && typeof body.localBranchBase !== 'string') {
      return c.json({ error: 'localBranchBase must be a string' }, 400)
    }
    if (body.vbranchName !== undefined && typeof body.vbranchName !== 'string') {
      return c.json({ error: 'vbranchName must be a string' }, 400)
    }
    try {
      const parseOpts: Parameters<typeof parseSessionInput>[1] = {}
      if (typeof body.localBranchHead === 'string') parseOpts.localBranchHead = body.localBranchHead
      if (typeof body.localBranchBase === 'string') parseOpts.localBranchBase = body.localBranchBase
      if (typeof body.vbranchName === 'string') parseOpts.vbranchName = body.vbranchName
      const source = parseSessionInput(body.prInput, parseOpts)

      const input: Parameters<typeof deps.startSession>[0] = { source }
      if (body.agent !== undefined) input.agent = body.agent
      if (typeof body.localRepoPath === 'string' && body.localRepoPath.trim().length > 0) {
        input.localRepoPath = body.localRepoPath
      }
      if (typeof body.extraPrompt === 'string' && body.extraPrompt.trim().length > 0) {
        input.extraPrompt = body.extraPrompt
      }
      const { id } = await deps.startSession(input)
      return c.json({ id }, 201)
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
  })
  r.get('/sessions/:id', (c) => {
    const id = c.req.param('id')
    const s = deps.sessions.getById(id)
    if (!s) return c.json({ error: 'not found' }, 404)
    // Archived sessions show their historical findings as read-only — all of
    // those rows carry archived=1 (rerun-session.ts archives them in lockstep
    // with the status flip), so the default `archived=0` filter would hide
    // every entry. Other statuses keep the active-only view.
    const findings = deps.findings.listBySession(id, {
      includeArchived: s.status === 'archived',
    })
    return c.json({ session: s, findings })
  })
  r.get('/sessions/:id/diff', (c) => {
    const id = c.req.param('id')
    const s = deps.sessions.getById(id)
    if (!s) return c.json({ error: 'not found' }, 404)
    const cache = join(s.workdir, 'diff.cache')
    const diff = existsSync(cache) ? readFileSync(cache, 'utf8') : null
    return c.json({ diff })
  })
  // Serve the full content of a diff-touched file so the UI can expand the
  // context hidden between diff hunks (GitHub-style). Reads from the session's
  // materialized source (worktree / snapshot); for `none` sources — or a disk
  // miss — falls back to fetching the blob at the PR head SHA via the Contents
  // API and caches it under <workdir>/fetched for repeat expansions.
  r.get('/sessions/:id/file', async (c) => {
    const id = c.req.param('id')
    const s = deps.sessions.getById(id)
    if (!s) return c.json({ error: 'not found' }, 404)
    const rel = c.req.query('path')
    if (typeof rel !== 'string' || rel.length === 0) {
      return c.json({ error: 'path required' }, 400)
    }
    // Capability boundary: this endpoint only exists to expand the hidden
    // context of diff-touched files, so restrict it to the paths that actually
    // appear in this session's review diff. Without this, any local caller that
    // knows the session id could read arbitrary repo files (e.g. `.env`) — or,
    // via the GitHub fallback, any file in a private repo at the head SHA using
    // the user's gh credentials, neither of which is in the product contract.
    const diffCache = join(s.workdir, 'diff.cache')
    const diffText = existsSync(diffCache) ? readFileSync(diffCache, 'utf8') : ''
    if (!diffTouchedPaths(diffText).has(rel)) {
      return c.json({ error: 'not in diff' }, 404)
    }
    // Read candidates in priority order. Two layers of containment: a cheap
    // lexical `..`-escape check, then a realpath check that also defeats
    // symlinks inside the source tree (a checked-out PR could carry e.g.
    // `src/secret -> ~/.ssh/id_rsa`; following it would leak files outside the
    // session dir). Both the candidate dir and the resolved target are
    // canonicalised before comparison so the macOS /var → /private/var symlink
    // doesn't trip the guard.
    const fetchCache = join(s.workdir, 'fetched')
    const candidates: string[] = []
    if (s.sourceKind === 'worktree') candidates.push(worktreeDirFor(s.workdir))
    if (s.sourceKind === 'snapshot') candidates.push(snapshotDirFor(s.workdir))
    candidates.push(fetchCache)
    for (const dir of candidates) {
      const resolved = resolve(dir, rel)
      if (resolved !== dir && !resolved.startsWith(dir + sep)) {
        return c.json({ error: 'invalid path' }, 400)
      }
      if (!existsSync(resolved) || !statSync(resolved).isFile()) continue
      let realDir: string
      let realTarget: string
      try {
        realDir = realpathSync(dir)
        realTarget = realpathSync(resolved)
      } catch {
        return c.json({ error: 'file unavailable' }, 404)
      }
      if (realTarget !== realDir && !realTarget.startsWith(realDir + sep)) {
        // Symlink escapes the source tree — refuse to read through it.
        return c.json({ error: 'invalid path' }, 400)
      }
      return c.json({ content: readFileSync(realTarget, 'utf8') })
    }
    // Disk miss: fetch from GitHub at head SHA when this is a github-pr source.
    if (s.headSha && s.owner && s.repo) {
      try {
        const content = await deps.gh.getFileAtRef({
          owner: s.owner,
          repo: s.repo,
          path: rel,
          ref: s.headSha,
        })
        try {
          const dst = resolve(fetchCache, rel)
          if (dst === fetchCache || dst.startsWith(fetchCache + sep)) {
            mkdirSync(dirname(dst), { recursive: true })
            writeFileSync(dst, content)
          }
        } catch {
          // Cache write is best-effort; serve the content regardless.
        }
        return c.json({ content })
      } catch {
        return c.json({ error: 'file unavailable' }, 404)
      }
    }
    return c.json({ error: 'file unavailable' }, 404)
  })
  // Replay the persisted agent.log into transcript lines so completed
  // sessions keep a read-only view of their last run after a page reload
  // (the live agent-output SSE stream is gone once the session ends).
  r.get('/sessions/:id/transcript', (c) => {
    const id = c.req.param('id')
    const s = deps.sessions.getById(id)
    if (!s) return c.json({ error: 'not found' }, 404)
    const logPath = join(s.workdir, 'agent.log')
    if (!existsSync(logPath)) return c.json({ chunks: [], truncated: false })
    const lines = readFileSync(logPath, 'utf8').split('\n')
    const truncated = lines.length > TRANSCRIPT_TAIL_LINES
    const tail = truncated ? lines.slice(-TRANSCRIPT_TAIL_LINES) : lines
    const chunks = getAgent(s.agent).parseLog(tail.join('\n'))
    return c.json({ chunks, truncated })
  })
  // Replay the persisted prep.log so refresh during prep does not lose the
  // phase timeline or any captured gh stdout/stderr. Mirrors /transcript.
  r.get('/sessions/:id/prep-log', (c) => {
    const id = c.req.param('id')
    const s = deps.sessions.getById(id)
    if (!s) return c.json({ error: 'not found' }, 404)
    const logPath = join(s.workdir, 'prep.log')
    if (!existsSync(logPath)) {
      return c.json({ phases: [], calls: [], truncated: false })
    }
    const phases: PrepStep[] = []
    const calls: PrepCall[] = []
    const lines = readFileSync(logPath, 'utf8').split('\n')
    for (const line of lines) {
      if (line.length === 0) continue
      let entry: unknown
      try {
        entry = JSON.parse(line)
      } catch {
        continue
      }
      if (!entry || typeof entry !== 'object') continue
      const e = entry as { kind?: unknown }
      if (e.kind === 'phase') {
        const p = entry as { phase: string; ts: number; detail?: string }
        const step: PrepStep = { phase: p.phase, ts: p.ts }
        if (p.detail !== undefined) step.detail = p.detail
        phases.push(step)
      } else if (e.kind === 'call') {
        const call = entry as PrepCall & { kind: string }
        calls.push({
          phase: call.phase,
          command: call.command,
          stdout: call.stdout,
          stderr: call.stderr,
          exitCode: call.exitCode,
          durationMs: call.durationMs,
          ts: call.ts,
        })
      }
    }
    const truncated = calls.length > PREP_LOG_TAIL_CALLS
    const tailCalls = truncated ? calls.slice(-PREP_LOG_TAIL_CALLS) : calls
    return c.json({ phases, calls: tailCalls, truncated })
  })
  r.delete('/sessions/:id', async (c) => {
    try {
      await deps.deleteSession(c.req.param('id'))
      return c.body(null, 204)
    } catch (e) {
      const msg = (e as Error).message
      if (msg === 'not found') return c.json({ error: msg }, 404)
      return c.json({ error: msg }, 500)
    }
  })
  r.post('/sessions/:id/cancel', async (c) => {
    try {
      await deps.cancelSession(c.req.param('id'))
      return c.body(null, 204)
    } catch (e) {
      const msg = (e as Error).message
      if (msg === 'not found') return c.json({ error: msg }, 404)
      if (msg === 'not running') return c.json({ error: msg }, 409)
      return c.json({ error: msg }, 500)
    }
  })
  r.post('/sessions/:id/rerun', async (c) => {
    let body: { agent?: unknown; extraPrompt?: unknown } = {}
    if (c.req.header('content-type')?.includes('application/json')) {
      try {
        body = await c.req.json<{ agent?: unknown; extraPrompt?: unknown }>()
      } catch {
        body = {}
      }
    }
    if (body.agent !== undefined && !isAgentKind(body.agent)) {
      return c.json({ error: `unknown agent: ${String(body.agent)}` }, 400)
    }
    if (body.extraPrompt !== undefined && typeof body.extraPrompt !== 'string') {
      return c.json({ error: 'extraPrompt must be a string' }, 400)
    }
    try {
      const opts: { agent?: AgentKind; extraPrompt?: string } = {}
      if (body.agent !== undefined) opts.agent = body.agent as AgentKind
      if (typeof body.extraPrompt === 'string') opts.extraPrompt = body.extraPrompt
      const result = await deps.rerunSession(c.req.param('id'), opts)
      return c.json(result, 202)
    } catch (e) {
      const msg = (e as Error).message
      if (msg === 'not found') return c.json({ error: msg }, 404)
      if (msg === 'already archived') return c.json({ error: msg }, 409)
      return c.json({ error: msg }, 400)
    }
  })
  return r
}
