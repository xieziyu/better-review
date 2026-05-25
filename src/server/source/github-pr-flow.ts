// SourceFlow implementation for the original GitHub PR path. Wraps the
// existing gh-client + source-prep + rerun-context helpers without
// changing behavior — this exists so `start-session` can dispatch
// uniformly across source kinds (Phase 1b adds LocalBranchFlow alongside).

import type { GithubPrSource } from '../../shared/source'
import { loadPriorReviewContext } from '../engine/rerun-context'
import { prepareSourceContext } from '../git/source-prep'
import type { GhClient } from '../github/gh-client'
import type { PRTarget } from '../github/pr-target-parser'
import type {
  LoadPriorContextArgs,
  PrepareSourceTreeArgs,
  SourceFlow,
  SourceMetadata,
} from './types'

export interface GithubPrFlowDeps {
  gh: GhClient
}

function targetOf(source: GithubPrSource): PRTarget {
  return { owner: source.owner, repo: source.repo, number: source.number }
}

export function makeGithubPrFlow(source: GithubPrSource, deps: GithubPrFlowDeps): SourceFlow {
  const target = targetOf(source)
  return {
    kind: 'github-pr',
    source,

    async fetchMetadata(): Promise<SourceMetadata> {
      const meta = await deps.gh.prView(target)
      return {
        title: meta.title,
        author: meta.author,
        url: meta.url,
        baseRef: meta.baseRef,
        headRef: meta.headRef,
        headSha: meta.headSha,
        body: meta.body,
      }
    },

    async fetchDiff() {
      const r = await deps.gh.prDiff(target)
      return { unifiedDiff: r.unifiedDiff }
    },

    async prepareSourceTree(args: PrepareSourceTreeArgs) {
      return prepareSourceContext({
        localRepoPath: args.localRepoPath,
        gh: deps.gh,
        target,
        headSha: args.headSha,
        unifiedDiff: args.unifiedDiff,
        sessionWorkdir: args.workdir,
        sessionShort: args.sessionShort,
        log: args.log,
      })
    },

    async loadPriorContext(args: LoadPriorContextArgs) {
      return loadPriorReviewContext(
        {
          sessions: args.sessions,
          submissions: args.submissions,
          submissionComments: args.submissionComments,
          gh: deps.gh,
          log: args.log,
        },
        { target, currentHeadSha: args.currentHeadSha, prAuthor: args.authorLogin },
      )
    },

    buildSourceMeta(meta: SourceMetadata): string {
      // Match the legacy `prMeta` string verbatim so prompts diff cleanly.
      return `#${source.number} ${meta.title ?? ''} by ${meta.author ?? '?'}\nURL: ${meta.url ?? ''}\n\n${meta.body}`
    },
  }
}
