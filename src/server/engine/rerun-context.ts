// Assembles the "what happened last time" packet that gets injected into
// the prompt and the incremental-diff annotator on rerun. Pulls:
//   1. The most-recent archived session for this PR (DB).
//   2. Its latest successful submission (DB) → identifies our GitHub
//      review by id.
//   3. Reviews + every PR review comment (GitHub) → threads author replies
//      under each of our top-level inline comments.
//   4. Issue (PR-level) comments (GitHub) → the main conversation thread.
//   5. compareCommits(lastReviewedSha, currentHeadSha) → force-push check.
//
// Every step that touches the network is wrapped in try/catch and degrades
// to either "no prior context" or "no incremental marker" rather than
// failing the review.

import type { SessionsRepo } from '../db/sessions'
import type { SubmissionCommentsRepo } from '../db/submission-comments'
import type { SubmissionsRepo } from '../db/submissions'
import type {
  GhClient,
  GhCompare,
  GhIssueComment,
  GhReview,
  GhReviewComment,
} from '../github/gh-client'
import type { PRTarget } from '../github/pr-target-parser'
import type { Logger } from '../logger'

export interface PriorAuthorReply {
  author: string
  body: string
  isAuthor: boolean
}

export interface PriorInlineComment {
  file: string | null
  line: number | null
  startLine: number | null
  body: string
  replies: PriorAuthorReply[]
  // Set when we can identify this comment as one we posted ourselves
  // (joined via submission_comments).
  ourFindingDbId: string | null
  ourCommentGithubId: number
}

export interface PriorReviewContext {
  priorSessionId: string
  lastReviewedSha: string | null
  currentHeadSha: string
  isForcePushed: boolean
  // Overall body of our prior review (may be empty when we never submitted).
  reviewBody: string
  inlineComments: PriorInlineComment[]
  // Flat, time-ordered. The PR author is flagged so the agent can weigh
  // those replies more heavily.
  issueComments: PriorAuthorReply[]
  // For UI: how many prior reviews there have been (== count of archived
  // sessions for this PR).
  priorRoundCount: number
  compare: GhCompare | null
}

export interface LoadPriorContextDeps {
  sessions: SessionsRepo
  submissions: SubmissionsRepo
  submissionComments: SubmissionCommentsRepo
  gh: GhClient
  log: Logger
}

export interface LoadPriorContextArgs {
  target: PRTarget
  currentHeadSha: string
  prAuthor: string | null
}

// Legacy submissions may not have `github_review_id` set yet (introduced
// in migration 0007). Parse it back out of the html_url as a fallback:
// .../pull/12#pullrequestreview-99
function parseReviewIdFromUrl(url: string | null): number | null {
  if (!url) return null
  const m = /pullrequestreview-(\d+)/.exec(url)
  return m && m[1] ? Number(m[1]) : null
}

function isForcePushed(compare: GhCompare | null): boolean {
  if (!compare) return false
  return compare.status === 'diverged' || compare.behind_by > 0
}

export async function loadPriorReviewContext(
  deps: LoadPriorContextDeps,
  args: LoadPriorContextArgs,
): Promise<PriorReviewContext | null> {
  const prior = deps.sessions.findLatestArchivedByPR(
    args.target.owner,
    args.target.repo,
    args.target.number,
  )
  if (!prior) return null

  const priorRoundCount = deps.sessions.countArchivedByPR(
    args.target.owner,
    args.target.repo,
    args.target.number,
  )

  // Best-effort prior submission. If the prior session never submitted, we
  // still want to inject "you reviewed this once before" — but with no
  // posted inline comments to display.
  const submission = deps.submissions.latestSuccessfulForSession(prior.id)
  const reviewIdFromSubmission =
    submission?.githubReviewId ?? parseReviewIdFromUrl(submission?.githubUrl ?? null)

  // Fan all four `gh api` calls out in parallel. compareCommits also lives
  // here when we already know the prior head sha (the common case post-
  // migration 0007); for legacy rows where head_sha is null we fall back
  // to deriving lastReviewedSha from the matched review and call compare
  // sequentially below.
  const compareTaskKnown: Promise<GhCompare | null> =
    prior.headSha && prior.headSha !== args.currentHeadSha
      ? deps.gh
          .compareCommits(
            { owner: args.target.owner, repo: args.target.repo },
            prior.headSha,
            args.currentHeadSha,
          )
          .catch((e: unknown) => {
            deps.log.warn('rerun-context: compareCommits failed', {
              error: (e as Error).message,
            })
            return null
          })
      : Promise.resolve(null)

  const [reviewsR, commentsR, issuesR, compareR] = await Promise.allSettled([
    deps.gh.listReviews(args.target),
    deps.gh.listAllPRComments(args.target),
    deps.gh.listIssueComments(args.target),
    compareTaskKnown,
  ])

  const reviews: GhReview[] = reviewsR.status === 'fulfilled' ? reviewsR.value : []
  if (reviewsR.status === 'rejected') {
    deps.log.warn('rerun-context: listReviews failed', {
      error: (reviewsR.reason as Error).message,
    })
  }
  const allComments: GhReviewComment[] = commentsR.status === 'fulfilled' ? commentsR.value : []
  if (commentsR.status === 'rejected') {
    deps.log.warn('rerun-context: listAllPRComments failed', {
      error: (commentsR.reason as Error).message,
    })
  }
  const issueComments: GhIssueComment[] = issuesR.status === 'fulfilled' ? issuesR.value : []
  if (issuesR.status === 'rejected') {
    deps.log.warn('rerun-context: listIssueComments failed', {
      error: (issuesR.reason as Error).message,
    })
  }
  let compare: GhCompare | null = compareR.status === 'fulfilled' ? compareR.value : null

  const ourReview = reviewIdFromSubmission
    ? reviews.find((r) => r.id === reviewIdFromSubmission)
    : undefined

  // Build per-comment reply threads. Replies have `in_reply_to_id` pointing
  // at the top-level (or another reply — GitHub stores deep threads flat,
  // all referencing the original top-level).
  const repliesByTarget = new Map<number, GhReviewComment[]>()
  for (const c of allComments) {
    if (c.in_reply_to_id === null) continue
    const list = repliesByTarget.get(c.in_reply_to_id) ?? []
    list.push(c)
    repliesByTarget.set(c.in_reply_to_id, list)
  }

  // "Our" top-level comments = inline comments whose pull_request_review_id
  // matches the review we submitted (if we can identify it).
  const ourTopLevel = ourReview
    ? allComments.filter(
        (c) => c.pull_request_review_id === ourReview.id && c.in_reply_to_id === null,
      )
    : []

  // Recover our finding mapping from submission_comments so each prior
  // top-level comment knows which finding produced it. Old submissions
  // without rows just get nulls — degrades gracefully.
  const ourMapping = submission ? deps.submissionComments.listBySubmission(submission.id) : []
  const findingByGithubId = new Map<number, string>()
  for (const m of ourMapping) {
    if (m.githubCommentId !== null && m.findingDbId !== null) {
      findingByGithubId.set(m.githubCommentId, m.findingDbId)
    }
  }

  const toReply = (c: GhReviewComment | GhIssueComment): PriorAuthorReply => ({
    author: c.user?.login ?? '?',
    body: c.body,
    isAuthor: c.user?.login !== undefined && c.user.login === args.prAuthor,
  })

  const inlineComments: PriorInlineComment[] = ourTopLevel.map((c) => ({
    file: c.path,
    line: c.line,
    startLine: c.start_line,
    body: c.body,
    replies: (repliesByTarget.get(c.id) ?? []).map(toReply),
    ourFindingDbId: findingByGithubId.get(c.id) ?? null,
    ourCommentGithubId: c.id,
  }))

  // Issue comments are flat by definition; preserve time order.
  const issueRendered: PriorAuthorReply[] = [...issueComments]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(toReply)

  // Need both ends to detect force-push and to compute the increment.
  // When unavailable, downstream skips the "NEW since" annotation but
  // does NOT claim force-push (we genuinely don't know).
  const lastReviewedSha = prior.headSha ?? ourReview?.commit_id ?? null
  if (!compare && !prior.headSha && lastReviewedSha && lastReviewedSha !== args.currentHeadSha) {
    // Legacy session row without head_sha: we only just learned the sha
    // from the review object, so this compare runs sequentially after
    // the parallel batch above.
    try {
      compare = await deps.gh.compareCommits(
        { owner: args.target.owner, repo: args.target.repo },
        lastReviewedSha,
        args.currentHeadSha,
      )
    } catch (e) {
      deps.log.warn('rerun-context: compareCommits failed', { error: (e as Error).message })
    }
  }

  return {
    priorSessionId: prior.id,
    lastReviewedSha,
    currentHeadSha: args.currentHeadSha,
    isForcePushed: isForcePushed(compare),
    reviewBody: ourReview?.body ?? '',
    inlineComments,
    issueComments: issueRendered,
    priorRoundCount,
    compare,
  }
}
