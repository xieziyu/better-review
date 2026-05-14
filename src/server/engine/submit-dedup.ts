// Backstop for prompt-layer rerun dedup. Given the proposed inline
// comments (built by payload-builder from this session's findings) and the
// inline comments we previously posted for the same PR, drop the obvious
// duplicates so we don't spam GitHub with another copy of "same issue,
// same line" when the agent re-discovers something the prior round
// already flagged.
//
// Matching is intentionally conservative for v1:
//   - same path,
//   - line ranges overlap (inclusive),
//   - normalized titles share a meaningful substring.
// "Title" for the prior side is the first non-empty line of the comment
// body (where the severity tag lives); for the proposed side it's the
// first line of the rendered inline body, which payload-builder already
// builds in the same shape.

import type { ReviewComment } from '../github/gh-client'

export interface PriorPostedComment {
  // findingDbId for traceability when surfacing the skip to the user.
  findingDbId: string | null
  githubCommentId: number | null
  path: string
  line: number
  startLine: number | null
  // Raw body of the prior comment as it sits on GitHub.
  body: string
}

export interface SkippedDuplicate {
  comment: ReviewComment
  reason: string
  priorMatch: PriorPostedComment
}

export interface DedupResult {
  toSubmit: ReviewComment[]
  skipped: SkippedDuplicate[]
}

// Strip the leading severity tag (🔴/🟡/🔵 + **[xxx]**) and keep the rest
// of the first non-empty line. Lowercase, strip leading punctuation, and
// collapse whitespace.
function normalizeTitle(raw: string): string {
  const firstLine = raw.split('\n').find((l) => l.trim().length > 0) ?? ''
  return firstLine
    .replace(/^[\u{1F534}\u{1F7E1}\u{1F535}]\s*\*\*\[[^\]]+\]\*\*\s*/u, '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const MIN_OVERLAP = 12

function titlesMatch(a: string, b: string): boolean {
  const na = normalizeTitle(a)
  const nb = normalizeTitle(b)
  if (na.length === 0 || nb.length === 0) return false
  if (na === nb) return true
  const shorter = na.length <= nb.length ? na : nb
  const longer = na.length <= nb.length ? nb : na
  if (shorter.length < MIN_OVERLAP) return false
  return longer.includes(shorter)
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aEnd >= bStart && aStart <= bEnd
}

function rangeOf(c: { line: number; start_line?: number }): [number, number] {
  const start = c.start_line && c.start_line < c.line ? c.start_line : c.line
  return [start, c.line]
}

function priorRange(p: PriorPostedComment): [number, number] {
  const start = p.startLine !== null && p.startLine < p.line ? p.startLine : p.line
  return [start, p.line]
}

export function dedupAgainstPrior(
  proposed: ReviewComment[],
  prior: PriorPostedComment[],
): DedupResult {
  if (prior.length === 0) return { toSubmit: proposed, skipped: [] }
  const toSubmit: ReviewComment[] = []
  const skipped: SkippedDuplicate[] = []
  for (const c of proposed) {
    let match: PriorPostedComment | null = null
    const [cs, ce] = rangeOf(c)
    for (const p of prior) {
      if (p.path !== c.path) continue
      const [ps, pe] = priorRange(p)
      if (!rangesOverlap(cs, ce, ps, pe)) continue
      if (!titlesMatch(c.body, p.body)) continue
      match = p
      break
    }
    if (match) {
      skipped.push({
        comment: c,
        reason: 'matches prior comment on same lines',
        priorMatch: match,
      })
    } else {
      toSubmit.push(c)
    }
  }
  return { toSubmit, skipped }
}
