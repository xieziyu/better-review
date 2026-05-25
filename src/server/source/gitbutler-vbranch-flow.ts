// SourceFlow implementation for reviewing a single GitButler virtual
// branch. The shape is almost identical to local-branch — the only new
// step is asking `but status --json` to resolve the vbranch name into
// (tipSha, baseSha) before the rest of the engine kicks in. Once those
// are known, the diff and source-tree paths reuse the existing git
// plumbing verbatim (same `git diff` two-dot semantics, same detached
// worktree).
//
// Like local-branch, vbranch reviews have no concept of a prior
// submission (there is no GitHub thread to thread against). Submission
// is gated as not-supported by the API layer.

import type { GitButlerVBranchSource } from '../../shared/source'
import { butStatus } from '../gitbutler/cli'
import { foldStatusToVBranches, type VBranchInfo } from '../gitbutler/inspect'
import { assertGitRepo, readCommitMeta, readDiff } from '../git/local-branch'
import { prepareLocalSourceContext } from '../git/local-source-prep'
import type {
  LoadPriorContextArgs,
  PrepareSourceTreeArgs,
  SourceFlow,
  SourceMetadata,
} from './types'

export class VBranchNotFoundError extends Error {
  constructor(repoPath: string, vbranchName: string) {
    super(
      `virtual branch "${vbranchName}" not found in GitButler workspace at ${repoPath} (is it applied?)`,
    )
    this.name = 'VBranchNotFoundError'
  }
}

export class VBranchEmptyError extends Error {
  constructor(repoPath: string, vbranchName: string) {
    super(
      `virtual branch "${vbranchName}" at ${repoPath} has no commits — nothing to review`,
    )
    this.name = 'VBranchEmptyError'
  }
}

export function makeGitButlerVBranchFlow(source: GitButlerVBranchSource): SourceFlow {
  // Cache the resolved vbranch entry once per flow construction so
  // fetchMetadata/fetchDiff don't each shell out to `but status`.
  let cachedVBranch: VBranchInfo | null = null

  async function ensureVBranch(): Promise<VBranchInfo> {
    if (cachedVBranch) return cachedVBranch
    await assertGitRepo(source.repoPath)
    const status = await butStatus(source.repoPath)
    const all = foldStatusToVBranches(status)
    const match = all.find((v) => v.name === source.vbranchName)
    if (!match) {
      // Empty branches are dropped by foldStatusToVBranches, so a missing
      // match could mean either "branch unknown" or "branch has no
      // commits". Differentiate so the API error is actionable.
      const exists = status.stacks.some((s) =>
        s.branches.some((b) => b.name === source.vbranchName),
      )
      if (exists) throw new VBranchEmptyError(source.repoPath, source.vbranchName)
      throw new VBranchNotFoundError(source.repoPath, source.vbranchName)
    }
    cachedVBranch = match
    return match
  }

  return {
    kind: 'gitbutler-vbranch',
    source,

    async fetchMetadata(): Promise<SourceMetadata> {
      const v = await ensureVBranch()
      const meta = await readCommitMeta(source.repoPath, v.tipSha)
      return {
        title: meta.subject || null,
        author: meta.author,
        url: null,
        baseRef: v.baseSha,
        // `headRef` is shown in the UI as a "branch" pill — the vbranch
        // name fits that role naturally even though it doesn't exist as
        // a git ref outside the GitButler workspace.
        headRef: source.vbranchName,
        headSha: v.tipSha,
        body: meta.body,
      }
    },

    async fetchDiff(): Promise<{ unifiedDiff: string }> {
      const v = await ensureVBranch()
      // readDiff() uses three-dot semantics, but for a stacked vbranch
      // the base IS an ancestor of the tip (it's the parent branch's
      // tip), so the merge-base reduces back to baseSha and the result
      // is identical to a two-dot diff — exactly this branch's own
      // commits, no parent commits leaking in.
      const unifiedDiff = await readDiff(source.repoPath, v.baseSha, v.tipSha)
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
      return null
    },

    buildSourceMeta(meta: SourceMetadata): string {
      const sha = meta.headSha ? meta.headSha.slice(0, 12) : '???'
      const base = meta.baseRef ? meta.baseRef.slice(0, 12) : 'unknown base'
      const author = meta.author ?? '?'
      const subject = meta.title ?? ''
      const header = `gitbutler-vbranch ${source.vbranchName}@${sha}  (base: ${base})  by ${author}`
      const body = meta.body.length > 0 ? `\n\n${meta.body}` : ''
      return subject ? `${header}\n${subject}${body}` : `${header}${body}`
    },
  }
}
