import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, beforeEach } from 'vitest'

import { PromptStore, type WritableScope } from '../../../src/server/prompts/store'

describe('PromptStore', () => {
  let cwd: string
  let home: string
  let store: PromptStore
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'br-pcwd-'))
    home = mkdtempSync(join(tmpdir(), 'br-phome-'))
    store = new PromptStore({ cwd, home })
  })

  it('write/read project scope', () => {
    store.write('project', 'PROJECT')
    expect(store.read('project')).toBe('PROJECT')
    expect(existsSync(join(cwd, '.better-review', 'review.md'))).toBe(true)
  })

  it('write/read global scope', () => {
    store.write('global', 'GLOBAL')
    expect(store.read('global')).toBe('GLOBAL')
  })

  it('delete clears file', () => {
    store.write('project', 'X')
    store.delete('project')
    expect(store.read('project')).toBeNull()
  })

  it('rejects writing to cwd alias', () => {
    expect(() => store.write('cwd' as unknown as WritableScope, 'x')).toThrow()
  })
})
