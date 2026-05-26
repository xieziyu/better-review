import type { Severity } from '@shared/findings-schema'
import type {
  ExcludedFile,
  Finding,
  ReviewSummaryFromAgent,
  SessionStatus,
} from '@shared/types'

import { buildFileAliasMap, canonicalFilePath, type FileSummary } from './diff-utils'

// Per-file outcome, in priority order — a file gets the first status that
// applies, so the coverage table can sort the most-actionable rows to the top.
//  - excluded:   dropped by a skip-review glob; the agent never saw it.
//  - flagged:    the agent asked for human review, or it carries a `must` finding.
//  - found:      reviewed, has at least one finding.
//  - pending:    agent is still running and hasn't yet produced findings for this file.
//  - incomplete: the run stopped before completing (failed/cancelled) — we can't
//                claim this file was actually reviewed.
//  - clean:      reviewed, no findings.
export type CoverageStatus =
  | 'excluded'
  | 'flagged'
  | 'found'
  | 'pending'
  | 'incomplete'
  | 'clean'

const SEV_ORDER: Severity[] = ['must', 'should', 'nit']

export interface CoverageRow {
  path: string
  additions: number
  deletions: number
  status: CoverageStatus
  findingCount: number
  /** Severities present on this file, sorted must → should → nit. */
  severities: Severity[]
  /** The glob that excluded this file, when `status === 'excluded'`. */
  excludedGlob: string | null
}

export interface SummaryStats {
  fileCount: number
  additions: number
  deletions: number
  findingCounts: { must: number; should: number; nit: number; total: number }
  excludedCount: number
}

// One row of the curated "needs human review" list. `source` distinguishes a
// reason the agent wrote from one the tool derived (a file carrying a `must`
// finding the agent didn't separately call out).
export interface AttentionItem {
  /** Canonical file path, or null for a PR-wide note. */
  file: string | null
  reason: string | null
  source: 'agent' | 'derived'
  findingCount: number
  hasMust: boolean
}

export interface ReviewCoverage {
  stats: SummaryStats
  rows: CoverageRow[]
  attention: AttentionItem[]
}

const STATUS_RANK: Record<CoverageStatus, number> = {
  flagged: 0,
  found: 1,
  pending: 2,
  incomplete: 3,
  clean: 4,
  excluded: 5,
}

// Map session status → the fallback coverage status assigned to a file with no
// findings. `ready` / `submitted` / `archived` are the only states that mean
// the agent ran to completion, so only those can show `clean`. Treat any
// unknown future SessionStatus as `incomplete` to err on the side of not
// over-claiming coverage.
function fallbackForStatus(status: SessionStatus | undefined): 'clean' | 'pending' | 'incomplete' {
  switch (status) {
    case 'pending':
    case 'running':
      return 'pending'
    case 'failed':
    case 'cancelled':
      return 'incomplete'
    case 'ready':
    case 'submitted':
    case 'archived':
    case undefined:
      return 'clean'
  }
}

/**
 * Fold the diff file list, the findings, the prep-time exclusions, and the
 * agent's summary into the data the Summary tab renders. Pure — safe to call
 * inside a `useMemo`. All file keys are canonicalised through the diff's alias
 * map so rename-old-path findings line up with the new display path.
 */
export function computeReviewCoverage(
  files: FileSummary[],
  findings: Finding[],
  excludedFiles: ExcludedFile[],
  summary: ReviewSummaryFromAgent | null,
  // Drives the fallback status for files without findings. Omit / undefined to
  // treat the run as complete (the old behaviour) — used by tests that don't
  // care about the running/incomplete distinction.
  sessionStatus?: SessionStatus,
): ReviewCoverage {
  const aliasMap = buildFileAliasMap(files)

  // Index findings by canonical file path.
  const countByFile = new Map<string, number>()
  const sevsByFile = new Map<string, Set<Severity>>()
  const mustFiles = new Set<string>()
  const findingCounts = { must: 0, should: 0, nit: 0, total: 0 }
  for (const f of findings) {
    findingCounts[f.severity] += 1
    findingCounts.total += 1
    if (!f.file) continue
    const key = canonicalFilePath(aliasMap, f.file)
    countByFile.set(key, (countByFile.get(key) ?? 0) + 1)
    const sevs = sevsByFile.get(key) ?? new Set<Severity>()
    sevs.add(f.severity)
    sevsByFile.set(key, sevs)
    if (f.severity === 'must') mustFiles.add(key)
  }

  // Index exclusions by canonical path.
  const excludedByFile = new Map<string, string>()
  for (const e of excludedFiles) {
    excludedByFile.set(canonicalFilePath(aliasMap, e.path), e.glob)
  }

  // Index the agent's manual-review notes by canonical path; null-file notes
  // are PR-wide and tracked separately.
  const agentReasonByFile = new Map<string, string>()
  const agentPrWide: { reason: string }[] = []
  for (const item of summary?.manualReview ?? []) {
    if (item.file == null) {
      agentPrWide.push({ reason: item.reason })
    } else {
      agentReasonByFile.set(canonicalFilePath(aliasMap, item.file), item.reason)
    }
  }

  const fallback = fallbackForStatus(sessionStatus)
  const rows: CoverageRow[] = files.map((f) => {
    const excludedGlob = excludedByFile.get(f.path) ?? null
    const findingCount = countByFile.get(f.path) ?? 0
    const flaggedByAgent = agentReasonByFile.has(f.path)
    const hasMust = mustFiles.has(f.path)
    const status: CoverageStatus = excludedGlob
      ? 'excluded'
      : flaggedByAgent || hasMust
        ? 'flagged'
        : findingCount > 0
          ? 'found'
          : fallback
    return {
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      status,
      findingCount,
      severities: SEV_ORDER.filter((s) => sevsByFile.get(f.path)?.has(s)),
      excludedGlob,
    }
  })
  rows.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status])

  // Attention list: every agent note, then any `must`-carrying file the agent
  // did not separately call out (so a serious finding is never hidden).
  const attention: AttentionItem[] = []
  for (const item of summary?.manualReview ?? []) {
    const key = item.file == null ? null : canonicalFilePath(aliasMap, item.file)
    attention.push({
      file: key,
      reason: item.reason,
      source: 'agent',
      findingCount: key ? (countByFile.get(key) ?? 0) : 0,
      hasMust: key ? mustFiles.has(key) : false,
    })
  }
  const calledOut = new Set(attention.map((a) => a.file).filter((f): f is string => f !== null))
  for (const key of mustFiles) {
    if (calledOut.has(key)) continue
    attention.push({
      file: key,
      reason: null,
      source: 'derived',
      findingCount: countByFile.get(key) ?? 0,
      hasMust: true,
    })
  }

  return {
    stats: {
      fileCount: files.length,
      additions: files.reduce((sum, f) => sum + f.additions, 0),
      deletions: files.reduce((sum, f) => sum + f.deletions, 0),
      findingCounts,
      excludedCount: excludedFiles.length,
    },
    rows,
    attention,
  }
}
