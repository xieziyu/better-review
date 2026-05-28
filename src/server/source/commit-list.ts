// Shared rendering for the multi-commit narrative that local-branch and
// vbranch flows splice into {{PR_META}}. Returns null when the caller
// should fall back to its single-body render (no commits, or only one
// commit — the existing tip-only output already shows that message).

import type { CommitEntry } from '../git/local-branch'

export function renderCommitList(commits: CommitEntry[] | undefined): string | null {
  if (!commits || commits.length < 2) return null
  const blocks: string[] = []
  for (const c of commits) {
    const short = c.sha.slice(0, 12)
    const head = `[${short}] ${c.subject}`
    if (c.body.length === 0) {
      blocks.push(head)
      continue
    }
    const indented = c.body
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n')
    blocks.push(`${head}\n${indented}`)
  }
  return `${commits.length} commits since base (oldest → newest):\n\n${blocks.join('\n\n')}`
}
