import { describe, expect, it } from 'vitest'

import { ClaudeAgent, formatClaudeEvent } from '../../../src/server/engine/agent/claude'

describe('formatClaudeEvent', () => {
  it('formats system init with model when present', () => {
    expect(
      formatClaudeEvent({ type: 'system', subtype: 'init', model: 'claude-opus-4-7' }),
    ).toEqual(['system: init (model=claude-opus-4-7)'])
  })

  it('formats system init without model', () => {
    expect(formatClaudeEvent({ type: 'system', subtype: 'init' })).toEqual(['system: init'])
  })

  it('returns nothing for unrelated system subtypes', () => {
    expect(formatClaudeEvent({ type: 'system', subtype: 'compact_boundary' })).toEqual([])
  })

  it('emits assistant text content trimmed', () => {
    const out = formatClaudeEvent({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: '  Reading the diff…  \n' },
          { type: 'text', text: '   ' },
          { type: 'text', text: 'Found a problem' },
        ],
      },
    })
    expect(out).toEqual(['Reading the diff…', 'Found a problem'])
  })

  it('emits tool_use as → tool: name(input)', () => {
    const out = formatClaudeEvent({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'Read',
            input: { file_path: '/tmp/foo.ts' },
          },
        ],
      },
    })
    expect(out).toEqual(['→ tool: Read({"file_path":"/tmp/foo.ts"})'])
  })

  it('truncates long tool_use input', () => {
    const out = formatClaudeEvent({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'Bash',
            input: { command: 'echo ' + 'x'.repeat(500) },
          },
        ],
      },
    })
    expect(out).toHaveLength(1)
    expect(out[0]!.startsWith('→ tool: Bash(')).toBe(true)
    expect(out[0]!.endsWith('…)')).toBe(true)
    expect(out[0]!.length).toBeLessThanOrEqual('→ tool: Bash('.length + 120 + 1)
  })

  it('mixes text and tool_use within one assistant event', () => {
    const out = formatClaudeEvent({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'About to read the file.' },
          { type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } },
        ],
      },
    })
    expect(out).toEqual(['About to read the file.', '→ tool: Read({"file_path":"a.ts"})'])
  })

  it('skips user/tool_result events entirely', () => {
    expect(
      formatClaudeEvent({
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'big payload' }],
        },
      }),
    ).toEqual([])
  })

  it('formats result with subtype and trailing summary', () => {
    expect(
      formatClaudeEvent({
        type: 'result',
        subtype: 'success',
        result: '  Wrote findings.json  ',
      }),
    ).toEqual(['result: success', 'Wrote findings.json'])
  })

  it('formats result without summary', () => {
    expect(formatClaudeEvent({ type: 'result', subtype: 'error_max_turns' })).toEqual([
      'result: error_max_turns',
    ])
  })

  it('returns empty for unknown event types', () => {
    expect(formatClaudeEvent({ type: 'something_else' })).toEqual([])
  })
})

describe('ClaudeAgent.parseLog', () => {
  const agent = new ClaudeAgent()

  it('reconstructs transcript lines from stream-json log', () => {
    const raw = [
      '{"type":"system","subtype":"init","model":"claude-opus-4-7"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Reading the diff"}]}}',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"a.ts"}}]}}',
      '{"type":"result","subtype":"success"}',
    ].join('\n')
    expect(agent.parseLog(raw)).toEqual([
      'system: init (model=claude-opus-4-7)',
      'Reading the diff',
      '→ tool: Read({"file_path":"a.ts"})',
      'result: success',
    ])
  })

  it('skips non-JSON noise lines (stderr fragments, error markers)', () => {
    const raw = [
      '{"type":"system","subtype":"init"}',
      '[stream-json error] Unexpected token',
      'some raw stderr chunk',
      '',
      '{"type":"result","subtype":"success"}',
    ].join('\n')
    expect(agent.parseLog(raw)).toEqual(['system: init', 'result: success'])
  })

  it('returns empty for empty input', () => {
    expect(agent.parseLog('')).toEqual([])
  })
})
