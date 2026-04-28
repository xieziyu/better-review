import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type WritableScope = 'project' | 'global'

export class PromptStore {
  constructor(private opts: { cwd: string; home: string }) {}

  private pathFor(scope: WritableScope): string {
    if (scope === 'project') return join(this.opts.cwd, '.better-review', 'review.md')
    return join(this.opts.home, 'review.md')
  }

  read(scope: WritableScope): string | null {
    const p = this.pathFor(scope)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }

  write(scope: WritableScope, content: string): void {
    if (scope !== 'project' && scope !== 'global') throw new Error(`invalid scope: ${scope}`)
    const p = this.pathFor(scope)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content)
  }

  delete(scope: WritableScope): void {
    const p = this.pathFor(scope)
    if (existsSync(p)) rmSync(p)
  }

  pathOf(scope: WritableScope): string {
    return this.pathFor(scope)
  }
}
