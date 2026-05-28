// SourceFlow is the per-source-kind seam that lets `start-session` drive
// reviews of GitHub PRs, local git branches, and (Phase 2) GitButler
// virtual branches behind one orchestration shell. Each implementation
// closes over a concrete `SessionSource` so the caller never has to pass
// it back in.
//
// Submission deliberately lives outside this interface — it has a different
// shape (synchronous user action, posts back to an external system, mutates
// session state) and is gated separately in `submit.ts` based on
// `session.source.kind`.

import type { SessionSource, SessionSourceKind } from '../../shared/source'
import type { SessionsRepo } from '../db/sessions'
import type { SubmissionCommentsRepo } from '../db/submission-comments'
import type { SubmissionsRepo } from '../db/submissions'
import type { PriorReviewContext } from '../engine/rerun-context'
import type { CommitEntry } from '../git/local-branch'
import type { SourceContext } from '../git/source-prep'
import type { Logger } from '../logger'

// What the session row needs to display + what the rest of the engine
// keys off (headSha for prior-context, baseRef/headRef for the UI).
// `body` is the free-form description that gets rendered into the
// prompt's {{SOURCE_META}} variable — for PRs it's the PR body, for
// local branches it'll be the latest commit message.
//
// `commits` is populated by source flows that diff against a base in a
// local clone (local-branch, vbranch) so the prompt can list every
// commit in `base..head`, not just the tip. The GitHub PR flow leaves
// it undefined — its `body` already aggregates the whole change.
export interface SourceMetadata {
  title: string | null
  author: string | null
  url: string | null
  baseRef: string | null
  headRef: string | null
  headSha: string
  body: string
  commits?: CommitEntry[]
}

export interface PrepareSourceTreeArgs {
  workdir: string
  sessionShort: string
  headSha: string
  unifiedDiff: string
  // Pinned local clone for the PR flow; null for kinds that already
  // operate on a local repo (local-branch, vbranch).
  localRepoPath: string | null
  log: Logger
}

export interface LoadPriorContextArgs {
  sessions: SessionsRepo
  submissions: SubmissionsRepo
  submissionComments: SubmissionCommentsRepo
  log: Logger
  currentHeadSha: string
  authorLogin: string | null
}

export interface SourceFlow {
  readonly kind: SessionSourceKind
  // The closed-over source — exposed so callers that already have a
  // flow do not need to keep the source object around separately.
  readonly source: SessionSource

  fetchMetadata(): Promise<SourceMetadata>
  fetchDiff(): Promise<{ unifiedDiff: string }>
  prepareSourceTree(args: PrepareSourceTreeArgs): Promise<SourceContext>

  // Returns null when this source kind has no concept of a prior review
  // (local-branch, vbranch). PR flow returns null when there is no
  // archived prior session yet.
  loadPriorContext(args: LoadPriorContextArgs): Promise<PriorReviewContext | null>

  // Builds the {{SOURCE_META}} string injected into the framework prompt.
  // PR flow renders the familiar `#N title by author\nURL: …\n\nbody`;
  // local-branch flow renders something like `local-branch: feat/x @abcd123`.
  buildSourceMeta(metadata: SourceMetadata): string
}
