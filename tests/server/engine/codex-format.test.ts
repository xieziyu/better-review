import { describe, expect, it } from 'vitest'

import { CodexAgent } from '../../../src/server/engine/agent/codex'

describe('CodexAgent.parseLog', () => {
  const agent = new CodexAgent()

  it('reconstructs transcript lines from plain-text log', () => {
    const raw = ['codex starting up', 'codex reading workspace', 'codex turn complete'].join('\n')
    expect(agent.parseLog(raw)).toEqual([
      'codex starting up',
      'codex reading workspace',
      'codex turn complete',
    ])
  })

  it('drops empty and whitespace-only lines', () => {
    const raw = 'line one\n\n   \nline two\n'
    expect(agent.parseLog(raw)).toEqual(['line one', 'line two'])
  })

  it('returns empty for empty input', () => {
    expect(agent.parseLog('')).toEqual([])
  })
})
