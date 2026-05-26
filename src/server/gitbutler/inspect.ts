// Public-facing GitButler inspection: turns the raw `but status` JSON
// into a normalized shape the API + frontend consume. Encapsulates the
// stack-relative base resolution: each vbranch's review base is the
// *tip of the next branch down its stack*, not the workspace mergeBase.
// Only the bottommost branch in a stack uses mergeBase as its base.

import { existsSync } from 'node:fs'

import { execa } from 'execa'

import { ButCliError, butStatus, type ButStatus } from './cli'

export interface VBranchInfo {
  name: string
  // Tip commit sha — the branch's first (newest) commit. Empty stacks
  // (branches with no commits yet) are dropped from the listing because
  // reviewing zero commits is meaningless.
  tipSha: string
  // Resolved review base. For stacked branches this is the tip of the
  // branch immediately below; for the bottommost branch in a stack it
  // equals the workspace mergeBase.
  baseSha: string
  // Number of commits this branch contributes to the stack (just this
  // branch, not the cumulative stack count).
  commitCount: number
  // Index inside its stack. 0 is the top of the stack.
  stackPosition: number
  // Total number of branches in the parent stack (handy for UI: "2 of 3
  // in stack").
  stackSize: number
}

export type GitButlerInspectKind = 'none' | 'git' | 'gitbutler'

export interface InspectResult {
  kind: GitButlerInspectKind
  // Path is echoed back so the API caller (which probably resolved `~/` /
  // relative paths server-side) can refresh its own state from the
  // response without re-implementing the resolution.
  repoPath: string
  // Present only when kind === 'gitbutler'.
  vbranches?: VBranchInfo[]
  // Workspace merge-base sha (target branch). Only present for
  // GitButler projects — used in the UI as a tooltip on the picker.
  mergeBaseSha?: string
  // Surfaced error message when GitButler probing failed despite a git
  // repo being present (e.g. `but` exists but the version mismatches
  // our parser). Lets the UI explain why we fell back to 'git'.
  warning?: string
}

// Quick check: does `repoPath` look like a git working tree? Used to
// short-circuit the GitButler probe — `but` is slow to start, and 99%
// of folders the user picks are plain non-git directories.
export async function isInsideGitWorkTree(repoPath: string): Promise<boolean> {
  if (!existsSync(repoPath)) return false
  const r = await execa('git', ['-C', repoPath, 'rev-parse', '--is-inside-work-tree'], {
    reject: false,
  })
  return r.exitCode === 0 && String(r.stdout ?? '').trim() === 'true'
}

// Fold a parsed status into the public vbranch shape. Pure — no IO so
// the table-driven tests can hand it canned JSON without spawning `but`.
export function foldStatusToVBranches(status: ButStatus): VBranchInfo[] {
  const out: VBranchInfo[] = []
  for (const stack of status.stacks) {
    const stackSize = stack.branches.length
    for (let i = 0; i < stack.branches.length; i++) {
      const branch = stack.branches[i]!
      if (branch.commits.length === 0) {
        // Empty branches sit in the stack but contribute no commits —
        // reviewing them yields an empty diff. Skip so the picker
        // doesn't offer unreviewable choices.
        continue
      }
      const tipSha = branch.commits[0]!.commitId
      // Stack-relative base: the branch immediately below us in the
      // stack contributes the next commit boundary. `branches[]` is
      // ordered top→bottom (see spike), so `branches[i + 1]` is one
      // step down. Falls through to mergeBase for the bottommost
      // branch (or any below-it branch that happens to be empty).
      let baseSha = status.mergeBase.commitId
      for (let j = i + 1; j < stack.branches.length; j++) {
        const below = stack.branches[j]!
        if (below.commits.length > 0) {
          baseSha = below.commits[0]!.commitId
          break
        }
      }
      out.push({
        name: branch.name,
        tipSha,
        baseSha,
        commitCount: branch.commits.length,
        stackPosition: i,
        stackSize,
      })
    }
  }
  return out
}

// Top-level inspect: classify a path as plain git / GitButler / not a
// repo, and list vbranches when applicable. Best-effort: a `but` parse
// failure downgrades us to 'git' kind with a warning rather than
// throwing — the frontend then shows the plain "local branch" tab.
export async function inspectLocalSource(repoPath: string): Promise<InspectResult> {
  if (!(await isInsideGitWorkTree(repoPath))) {
    return { kind: 'none', repoPath }
  }
  try {
    const status = await butStatus(repoPath)
    return {
      kind: 'gitbutler',
      repoPath,
      vbranches: foldStatusToVBranches(status),
      mergeBaseSha: status.mergeBase.commitId,
    }
  } catch (e) {
    if (e instanceof ButCliError) {
      // `setup_required` is the common case (a plain git repo without
      // GitButler init) — downgrade silently. Other errors get the
      // warning so the user knows why their GitButler project showed
      // up as plain git.
      if (e.code === 'setup_required' || e.code === 'not_a_repo' || e.code === 'missing') {
        const result: InspectResult = { kind: 'git', repoPath }
        if (e.code === 'missing') {
          result.warning =
            'GitButler CLI (`but`) is not installed; install it to review virtual branches'
        }
        return result
      }
      return { kind: 'git', repoPath, warning: e.message }
    }
    return { kind: 'git', repoPath, warning: (e as Error).message }
  }
}
