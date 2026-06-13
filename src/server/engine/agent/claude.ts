import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'

import { parseStreamJson, type StreamEvent } from '../stream-json'
import { shortJson } from './short-json'
import type { AgentRunHandle, AgentSpawnArgs, ReviewAgent } from './types'
import { whichBinary } from './which'

interface ClaudeContentBlock {
  type?: string
  text?: string
  name?: string
  input?: unknown
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
    const { executable, prompt, workdir, sourcePath, logPath, onProgress, onOutput, onResult } =
      args
    const child = spawn(executable, ['--output-format', 'stream-json', '--verbose', '-p', prompt], {
      cwd: sourcePath ?? workdir,
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

  // agent.log holds newline-delimited stream-json (plus the occasional raw
  // stderr fragment / `[stream-json error]` marker). Parse each line as JSON
  // and run it through the same formatter the live path uses; non-JSON lines
  // are stderr noise and get skipped, so the result mirrors live onOutput.
  parseLog(raw: string): string[] {
    const out: string[] = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let event: unknown
      try {
        event = JSON.parse(trimmed)
      } catch {
        continue
      }
      if (typeof event !== 'object' || event === null) continue
      const e = event as Record<string, unknown>
      if (typeof e.type !== 'string') continue
      for (const formatted of formatClaudeEvent(e as StreamEvent)) out.push(formatted)
    }
    return out
  }
}
