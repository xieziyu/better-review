import { z } from 'zod'

// A SessionSource is the durable identity of *what* a review session is
// reviewing. It replaces the implicit `(owner, repo, number)` triple that
// the original PR-only design relied on, so the same engine can drive
// reviews of GitHub PRs, local git branches, and (Phase 2) GitButler
// virtual branches.
//
// Persistence: serialized to the `source_json` column on `pr_sessions`,
// keyed for dedup via `sourceHash()` (stored in `source_hash`).

export const githubPrSourceSchema = z.object({
  kind: z.literal('github-pr'),
  owner: z.string().min(1),
  repo: z.string().min(1),
  number: z.number().int().positive(),
})

export const localBranchSourceSchema = z.object({
  kind: z.literal('local-branch'),
  // Absolute, resolved repo path. The caller is responsible for path
  // normalization before constructing this source — the schema just stores
  // what it gets so the dedup hash stays stable.
  repoPath: z.string().min(1),
  // Branch name or revision the user wants to review. May be a sha, a
  // branch shortname, or `HEAD`. The runtime resolves it to a concrete
  // commit when preparing the source tree.
  head: z.string().min(1),
  // Revision to diff `head` against. Defaults to the auto-detected merge-
  // base at parse time (see `LocalBranchProvider`); always concrete by the
  // time the source is persisted.
  base: z.string().min(1),
})

export const gitbutlerVbranchSourceSchema = z.object({
  kind: z.literal('gitbutler-vbranch'),
  repoPath: z.string().min(1),
  vbranchName: z.string().min(1),
  base: z.string().min(1),
})

export const sessionSourceSchema = z.discriminatedUnion('kind', [
  githubPrSourceSchema,
  localBranchSourceSchema,
  gitbutlerVbranchSourceSchema,
])

export type GithubPrSource = z.infer<typeof githubPrSourceSchema>
export type LocalBranchSource = z.infer<typeof localBranchSourceSchema>
export type GitButlerVBranchSource = z.infer<typeof gitbutlerVbranchSourceSchema>
export type SessionSource = z.infer<typeof sessionSourceSchema>
export type SessionSourceKind = SessionSource['kind']

// Stable, canonical JSON string for a source. Used both for storage
// (`source_json`) and as the input to `sourceHash`. Keys are emitted in a
// fixed order so two equal sources always serialize to the exact same
// string, even if the runtime constructs them with different key orders.
export function serializeSource(source: SessionSource): string {
  switch (source.kind) {
    case 'github-pr':
      return JSON.stringify({
        kind: 'github-pr',
        owner: source.owner,
        repo: source.repo,
        number: source.number,
      })
    case 'local-branch':
      return JSON.stringify({
        kind: 'local-branch',
        repoPath: source.repoPath,
        head: source.head,
        base: source.base,
      })
    case 'gitbutler-vbranch':
      return JSON.stringify({
        kind: 'gitbutler-vbranch',
        repoPath: source.repoPath,
        vbranchName: source.vbranchName,
        base: source.base,
      })
  }
}

export function parseSource(json: string): SessionSource {
  return sessionSourceSchema.parse(JSON.parse(json))
}

// sourceHash() lives in `src/server/source/hash.ts` so the shared bundle
// stays free of node:crypto (which the web build cannot resolve).
