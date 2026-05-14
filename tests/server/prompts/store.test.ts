import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, beforeEach } from 'vitest'

import { PromptStore, type WritableScope } from '../../../src/server/prompts/store'

describe('PromptStore', () => {
  let repo: string
  let home: string
  let store: PromptStore
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'br-repo-'))
    home = mkdtempSync(join(tmpdir(), 'br-phome-'))
    store = new PromptStore({ home })
  })

  it('write/read project scope against a repo path', () => {
    store.write('project', 'PROJECT', repo)
    expect(store.read('project', repo)).toBe('PROJECT')
    expect(existsSync(join(repo, '.better-review', 'review.md'))).toBe(true)
  })

  it('write/read global scope', () => {
    store.write('global', 'GLOBAL')
    expect(store.read('global')).toBe('GLOBAL')
  })

  it('project scope is isolated per repo', () => {
    const otherRepo = mkdtempSync(join(tmpdir(), 'br-repo2-'))
    store.write('project', 'A', repo)
    store.write('project', 'B', otherRepo)
    expect(store.read('project', repo)).toBe('A')
    expect(store.read('project', otherRepo)).toBe('B')
  })

  it('delete clears project file', () => {
    store.write('project', 'X', repo)
    store.delete('project', repo)
    expect(store.read('project', repo)).toBeNull()
  })

  it('throws when project scope is used without a repo path', () => {
    expect(() => store.read('project')).toThrow(/requires a repo path/)
    expect(() => store.write('project', 'x')).toThrow(/requires a repo path/)
  })

  it('rejects an unknown scope', () => {
    expect(() => store.write('bogus' as unknown as WritableScope, 'x')).toThrow()
  })
})
