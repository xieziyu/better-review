// SourceFlow implementation for reviewing a local git branch (worktrees
// reduce to this — the user just points at the worktree path). Diff
// uses three-dot semantics (`git diff base...head`) so the agent only
// sees commits unique to the chosen head, matching PR semantics.
//
// There is no concept of a "prior review" for local branches today;
// loadPriorContext() returns null and the rerun path falls through to
// "treat as fresh review" gracefully.

import type { LocalBranchSource } from '../../shared/source'
import { inspectLocalBranch, readDiff, resolveBase } from '../git/local-branch'
import { prepareLocalSourceContext } from '../git/local-source-prep'
import type {
  LoadPriorContextArgs,
  PrepareSourceTreeArgs,
  SourceFlow,
  SourceMetadata,
} from './types'

export function makeLocalBranchFlow(source: LocalBranchSource): SourceFlow {
  // Resolve once per flow construction. fetchMetadata() runs first inside
  // prepareReview and seeds these; later methods reuse the cached values
  // to avoid a second `git rev-parse` round trip.
  let cachedHeadSha: string | null = null
  let cachedBase: string | null = null

  async function ensureBase(): Promise<string> {
    if (cachedBase !== null) return cachedBase
    cachedBase = await resolveBase(source.repoPath, source.base)
    return cachedBase
  }

  return {
    kind: 'local-branch',
    source,

    async fetchMetadata(): Promise<SourceMetadata> {
      const inspect = await inspectLocalBranch(source.repoPath, source.head, {
        info: () => {},
        warn: () => {},
        error: () => {},
      })
      cachedHeadSha = inspect.headSha
      const base = await ensureBase()
      return {
        title: inspect.subject || null,
        author: inspect.author,
        url: null,
        baseRef: base,
        headRef: inspect.headRef,
        headSha: inspect.headSha,
        body: inspect.body,
      }
    },

    async fetchDiff(): Promise<{ unifiedDiff: string }> {
      // Guard against fetchDiff being called before fetchMetadata. In
      // practice prepareReview always calls metadata first, but resolving
      // again here is cheap and keeps the flow safe to use in isolation.
      if (cachedHeadSha === null) {
        const inspect = await inspectLocalBranch(source.repoPath, source.head, {
          info: () => {},
          warn: () => {},
          error: () => {},
        })
        cachedHeadSha = inspect.headSha
      }
      const base = await ensureBase()
      const unifiedDiff = await readDiff(source.repoPath, base, cachedHeadSha)
      return { unifiedDiff }
    },

    async prepareSourceTree(args: PrepareSourceTreeArgs) {
      return prepareLocalSourceContext({
        repoPath: source.repoPath,
        headSha: args.headSha,
        sessionWorkdir: args.workdir,
        log: args.log,
      })
    },

    async loadPriorContext(_args: LoadPriorContextArgs) {
      // Local branches have no archived prior session in our model — the
      // user is reviewing live, possibly-mutating local work. Returning
      // null keeps the rerun path falling through to "fresh review".
      return null
    },

    buildSourceMeta(meta: SourceMetadata): string {
      const ref = meta.headRef ?? '(detached)'
      const sha = meta.headSha ? meta.headSha.slice(0, 12) : '???'
      const base = meta.baseRef ?? 'unknown base'
      const author = meta.author ?? '?'
      const subject = meta.title ?? ''
      const header = `local-branch ${ref}@${sha}  (base: ${base})  by ${author}`
      const body = meta.body.length > 0 ? `\n\n${meta.body}` : ''
      return subject ? `${header}\n${subject}${body}` : `${header}${body}`
    },
  }
}
