import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'

import { parseStreamJson, type StreamEvent } from '../stream-json'
import type { AgentRunHandle, AgentSpawnArgs, ReviewAgent } from './types'
import { whichBinary } from './which'

const TOOL_INPUT_MAX = 120

interface ClaudeContentBlock {
  type?: string
  text?: string
  name?: string
  input?: unknown
}

function shortJson(v: unknown): string {
  let s: string
  try {
    s = JSON.stringify(v)
  } catch {
    s = String(v)
  }
  if (s === undefined) return ''
  if (s.length > TOOL_INPUT_MAX) s = s.slice(0, TOOL_INPUT_MAX - 1) + '…'
  return s
}

// Convert one claude stream-json event into zero or more human-readable
// transcript lines. Verbosity: assistant text and tool-call names; skip raw
// tool_result payloads. Returns [] for events that should not be surfaced.
export function formatClaudeEvent(e: StreamEvent): string[] {
  if (e.type === 'system' && e.subtype === 'init') {
    const model = typeof e.model === 'string' ? e.model : null
    return [model ? `system: init (model=${model})` : 'system: init']
  }
  if (e.type === 'assistant') {
    const message = (e as { message?: { content?: unknown } }).message
    const content = Array.isArray(message?.content) ? (message.content as ClaudeContentBlock[]) : []
    const out: string[] = []
    for (const block of content) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        const text = block.text.trim()
        if (text) out.push(text)
      } else if (block?.type === 'tool_use' && typeof block.name === 'string') {
        const input = block.input === undefined ? '' : shortJson(block.input)
        out.push(input ? `→ tool: ${block.name}(${input})` : `→ tool: ${block.name}`)
      }
    }
    return out
  }
  if (e.type === 'result') {
    const subtype = typeof e.subtype === 'string' ? e.subtype : 'unknown'
    const out = [`result: ${subtype}`]
    const raw = (e as { result?: unknown }).result
    if (typeof raw === 'string') {
      const text = raw.trim()
      if (text) out.push(text)
    }
    return out
  }
  return []
}

export class ClaudeAgent implements ReviewAgent {
  readonly kind = 'claude' as const
  readonly displayName = 'claude'

  findExecutable(): string | null {
    return whichBinary('claude')
  }

  spawn(args: AgentSpawnArgs): AgentRunHandle {
    const { executable, prompt, workdir, logPath, onProgress, onOutput, onResult } = args
    const child = spawn(executable, ['--output-format', 'stream-json', '--verbose', '-p', prompt], {
      cwd: workdir,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const drained = parseStreamJson(
      child.stdout!,
      (e) => {
        const detail = JSON.stringify(e).slice(0, 200)
        onProgress(e.type, detail)
        appendFileSync(logPath, JSON.stringify(e) + '\n')
        if (onOutput) {
          for (const line of formatClaudeEvent(e)) onOutput(line)
        }
        if (e.type === 'result') {
          onResult?.({ ok: e.subtype === 'success' })
        }
      },
      (err) => appendFileSync(logPath, `[stream-json error] ${err}\n`),
    )

    child.stderr?.on('data', (chunk) => appendFileSync(logPath, chunk))

    return { child, drained }
  }
}
