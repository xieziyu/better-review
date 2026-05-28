import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Finding, ReviewEvent } from '../../shared/types'
import type { FindingsRepo } from '../db/findings'
import type { SessionsRepo } from '../db/sessions'
import type { SubmissionCommentsRepo, NewSubmissionComment } from '../db/submission-comments'
import type { SubmissionsRepo } from '../db/submissions'
import type { GhClient, ReviewComment } from '../github/gh-client'
import { buildSubmitPayload } from './payload-builder'
import { dedupAgainstPrior, type PriorPostedComment } from './submit-dedup'

export interface SubmitArgs {
  sessionId: string
  event: ReviewEvent
  body?: string
  sessions: SessionsRepo
  findings: FindingsRepo
  submissions: SubmissionsRepo
  submissionComments: SubmissionCommentsRepo
  gh: GhClient
}

export interface SubmitResult {
  url: string
  droppedToBody: string[]
  // Count of inline comments we held back because they duplicated a
  // comment we already posted to the same PR in a prior submission.
  skippedDuplicates: number
}

// Pick the originating Finding for each ReviewComment we sent. The payload
// builder emits comments in the order of selected findings that survived
// `isLineInDiff`, so we walk in the same order and match by path+line.
function pairCommentsToFindings(
  comments: ReviewComment[],
  candidates: Finding[],
): Array<{ comment: ReviewComment; finding: Finding | null }> {
  const remaining = candidates.slice()
  return comments.map((c) => {
    const idx = remaining.findIndex(
      (f) =>
        f.file === c.path &&
        (f.line ?? null) === (c.line ?? null) &&
        (f.startLine ?? null) === (c.start_line ?? null),
    )
    if (idx >= 0) {
      const [f] = remaining.splice(idx, 1)
      return { comment: c, finding: f ?? null }
    }
    return { comment: c, finding: null }
  })
}

function firstLine(s: string): string {
  return s.split('\n').find((l) => l.trim().length > 0) ?? ''
}

export class SubmitNotSupportedError extends Error {
  constructor(kind: string) {
    super(`submit is not supported for ${kind} sessions`)
    this.name = 'SubmitNotSupportedError'
  }
}

export async function submitSession(args: SubmitArgs): Promise<SubmitResult> {
  const session = args.sessions.getById(args.sessionId)
  if (!session) throw new Error('session not found')
  // Only GitHub-PR sessions can be submitted upstream. Local-branch and
  // gitbutler-vbranch sessions are read-only by design — the UI hides
  // the Submit button entirely; this guard catches direct API hits.
  if (session.source.kind !== 'github-pr') {
    throw new SubmitNotSupportedError(session.source.kind)
  }
  const all = args.findings.listBySession(args.sessionId)
  const selected = all.filter((f) => f.selected)
  const diff = readFileSync(join(session.workdir, 'diff.cache'), 'utf8')
  const buildArgs: Parameters<typeof buildSubmitPayload>[0] = {
    diff,
    findings: selected,
    event: args.event,
  }
  if (args.body !== undefined) buildArgs.userBody = args.body
  const built = buildSubmitPayload(buildArgs)

  // Cross-session dedup: skip inline comments that match a comment we
  // already posted for this PR in a prior submission.
  const priorRows = args.submissionComments.listByPR(session.owner, session.repo, session.number)
  const prior: PriorPostedComment[] = priorRows
    .filter((r): r is typeof r & { file: string } => r.file !== null)
    .map((r) => ({
      findingDbId: r.findingDbId,
      githubCommentId: r.githubCommentId,
      path: r.file as string,
      line: r.line,
      startLine: r.startLine,
      body: r.body,
    }))
  const dedup = dedupAgainstPrior(built.payload.comments, prior)
  const payload = { ...built.payload, comments: dedup.toSubmit }

  const findingIds = selected.map((f) => f.dbId)
  // We pair the *post-dedup* inline comments back to findings so the
  // submission_comments rows reflect what actually went out. Inline here
  // means anything payload-builder turned into a ReviewComment, including
  // file-level (line=null) manual findings.
  const inlineFindingCandidates = selected.filter(
    (f) => f.file !== null && (f.line !== null || f.source === 'manual'),
  )
  try {
    const r = await args.gh.submitReview(
      { owner: session.owner, repo: session.repo, number: session.number },
      payload,
    )
    const submissionId = args.submissions.insert({
      sessionId: args.sessionId,
      event: args.event,
      githubUrl: r.html_url,
      githubReviewId: r.id,
      payloadJson: JSON.stringify(payload),
      findingIds,
      error: null,
    })
    // Best-effort: pull back the actual review comments to capture their
    // GitHub ids, and persist a row per posted inline comment. If the
    // fetch fails, we still write rows without github_comment_id so
    // future dedup can match by (file, line, body).
    let allComments: Awaited<ReturnType<GhClient['listAllPRComments']>> = []
    try {
      allComments = await args.gh.listAllPRComments({
        owner: session.owner,
        repo: session.repo,
        number: session.number,
      })
    } catch {
      allComments = []
    }
    const ourComments = allComments.filter(
      (c) => c.pull_request_review_id === r.id && c.in_reply_to_id === null,
    )
    const paired = pairCommentsToFindings(payload.comments, inlineFindingCandidates)
    // Consume `ourComments` one-by-one. For file-level comments `line` and
    // `start_line` are both null on every entry, so matching on
    // path+line+start_line alone collapses multiple file-level findings on
    // the same path onto the same GitHub comment id. Include `body` in the
    // match key and remove the matched entry so each GitHub comment is
    // claimed by exactly one outgoing comment.
    const rows: NewSubmissionComment[] = paired.map(({ comment, finding }) => {
      const matchIdx = ourComments.findIndex(
        (gc) =>
          gc.path === comment.path &&
          gc.line === (comment.line ?? null) &&
          (gc.start_line ?? null) === (comment.start_line ?? null) &&
          gc.body === comment.body,
      )
      const match = matchIdx >= 0 ? ourComments.splice(matchIdx, 1)[0] : undefined
      return {
        findingDbId: finding?.dbId ?? null,
        githubCommentId: match?.id ?? null,
        file: comment.path,
        line: comment.line ?? null,
        startLine: comment.start_line ?? null,
        title: firstLine(comment.body),
        body: comment.body,
      }
    })
    args.submissionComments.insertMany(submissionId, rows)

    args.sessions.setStatus(args.sessionId, 'submitted')
    return {
      url: r.html_url,
      droppedToBody: built.droppedToBody.map((f) => f.dbId),
      skippedDuplicates: dedup.skipped.length,
    }
  } catch (e) {
    args.submissions.insert({
      sessionId: args.sessionId,
      event: args.event,
      githubUrl: null,
      githubReviewId: null,
      payloadJson: JSON.stringify(payload),
      findingIds,
      error: (e as Error).message,
    })
    throw e
  }
}
