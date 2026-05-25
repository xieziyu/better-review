// Dispatcher: picks the SourceFlow implementation for a SessionSource.
// Kept tiny on purpose — adding a new source kind means adding one case
// here and a flow module next to it (no registration boilerplate).

import type { SessionSource } from '../../shared/source'
import type { GhClient } from '../github/gh-client'
import { makeGithubPrFlow } from './github-pr-flow'
import { makeLocalBranchFlow } from './local-branch-flow'
import type { SourceFlow } from './types'

export interface SourceFlowDeps {
  gh: GhClient
}

export function getSourceFlow(source: SessionSource, deps: SourceFlowDeps): SourceFlow {
  switch (source.kind) {
    case 'github-pr':
      return makeGithubPrFlow(source, { gh: deps.gh })
    case 'local-branch':
      return makeLocalBranchFlow(source)
    case 'gitbutler-vbranch':
      // Phase 2 adds GitButlerVBranchFlow.
      throw new Error('gitbutler-vbranch source is not implemented yet (Phase 2)')
  }
}
