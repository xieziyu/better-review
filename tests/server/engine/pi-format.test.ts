import { describe, expect, it } from 'vitest'

import { PiAgent, formatPiEvent } from '../../../src/server/engine/agent/pi'

describe('formatPiEvent', () => {
  it('emits assistant message_end text content trimmed', () => {
    const out = formatPiEvent({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: '  Reviewing the diff…  \n' },
          { type: 'text', text: '   ' },
          { type: 'text', text: 'Found a problem' },
        ],
      },
    })
    expect(out).toEqual(['Reviewing the diff…', 'Found a problem'])
  })

  it('skips message_end for non-assistant roles (echoed user prompt)', () => {
    expect(
      formatPiEvent({
        type: 'message_end',
        message: { role: 'user', content: [{ type: 'text', text: 'the prompt' }] },
      }),
    ).toEqual([])
  })

  it('emits tool_execution_start as → tool: name(args)', () => {
    expect(
      formatPiEvent({
        type: 'tool_execution_start',
        toolCallId: 'c1',
        toolName: 'write',
        args: { path: 'findings.json' },
      }),
    ).toEqual(['→ tool: write({"path":"findings.json"})'])
  })

  it('truncates long tool_execution_start args', () => {
    const out = formatPiEvent({
      type: 'tool_execution_start',
      toolName: 'bash',
      args: { command: 'echo ' + 'x'.repeat(500) },
    })
    expect(out).toHaveLength(1)
    expect(out[0]!.startsWith('→ tool: bash(')).toBe(true)
    expect(out[0]!.endsWith('…)')).toBe(true)
    expect(out[0]!.length).toBeLessThanOrEqual('→ tool: bash('.length + 120 + 1)
  })

  it('formats agent_end as result: ok', () => {
    expect(formatPiEvent({ type: 'agent_end', messages: [] })).toEqual(['result: ok'])
  })

  it('skips lifecycle / delta / retry noise', () => {
    for (const type of [
      'agent_start',
      'turn_start',
      'turn_end',
      'message_start',
      'message_update',
      'tool_execution_update',
      'tool_execution_end',
      'queue_update',
      'compaction_start',
      'auto_retry_start',
      'session',
    ]) {
      expect(formatPiEvent({ type })).toEqual([])
    }
  })
})

describe('PiAgent.parseLog', () => {
  const agent = new PiAgent()

  it('reconstructs transcript lines from json-mode log', () => {
    const raw = [
      '{"type":"session","version":3,"id":"x"}',
      '{"type":"tool_execution_start","toolName":"write","args":{"path":"a.json"}}',
      '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}',
      '{"type":"agent_end","messages":[]}',
    ].join('\n')
    expect(agent.parseLog(raw)).toEqual(['→ tool: write({"path":"a.json"})', 'done', 'result: ok'])
  })

  it('skips non-JSON noise lines (stderr fragments)', () => {
    const raw = [
      '{"type":"tool_execution_start","toolName":"read"}',
      'some raw stderr chunk',
      '',
      '{"type":"agent_end","messages":[]}',
    ].join('\n')
    expect(agent.parseLog(raw)).toEqual(['→ tool: read', 'result: ok'])
  })

  it('returns empty for empty input', () => {
    expect(agent.parseLog('')).toEqual([])
  })
})
