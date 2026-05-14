import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { projectPromptPath } from '../paths'

export type WritableScope = 'project' | 'global'

// Reads/writes the two user-owned override files. The `global` scope is a
// single file under `~/.better-review/`; the `project` scope lives inside a
// selected local repo (`<repo>/.better-review/review.md`), so every project
// operation must be told which repo it targets.
export class PromptStore {
  constructor(private opts: { home: string }) {}

  private pathFor(scope: WritableScope, repoPath?: string): string {
    if (scope === 'global') return join(this.opts.home, 'review.md')
    if (scope === 'project') {
      if (repoPath === undefined) throw new Error('project scope requires a repo path')
      return projectPromptPath(repoPath)
    }
    throw new Error(`invalid scope: ${String(scope)}`)
  }

  read(scope: WritableScope, repoPath?: string): string | null {
    const p = this.pathFor(scope, repoPath)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }

  write(scope: WritableScope, content: string, repoPath?: string): void {
    const p = this.pathFor(scope, repoPath)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content)
  }

  delete(scope: WritableScope, repoPath?: string): void {
    const p = this.pathFor(scope, repoPath)
    if (existsSync(p)) rmSync(p)
  }

  pathOf(scope: WritableScope, repoPath?: string): string {
    return this.pathFor(scope, repoPath)
  }
}
