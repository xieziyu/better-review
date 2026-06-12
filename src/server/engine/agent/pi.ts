import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'

import { consumeLines } from './lines'
import { shortJson } from './short-json'
import type { AgentRunHandle, AgentSpawnArgs, ReviewAgent } from './types'
import { whichBinary } from './which'

interface PiTextBlock {
  type?: string
  text?: string
}

export interface PiEvent {
  type?: string
  [k: string]: unknown
}

// Convert one `pi --mode json` event into zero or more human-readable
// transcript lines. Surfaces assistant message text, tool-call names, and the
// terminal result; skips token deltas, turn/message lifecycle noise, retries
// and compaction. Returns [] for events that should not be surfaced.
export function formatPiEvent(e: PiEvent): string[] {
  if (e.type === 'message_end') {
    const message = (e as { message?: { role?: unknown; content?: unknown } }).message
    if (!message || message.role !== 'assistant') return []
    const content = Array.isArray(message.content) ? (message.content as PiTextBlock[]) : []
    const out: string[] = []
    for (const block of content) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        const text = block.text.trim()
        if (text) out.push(text)
      }
    }
    return out
  }
  if (e.type === 'tool_execution_start') {
    const name = typeof e.toolName === 'string' ? e.toolName : 'tool'
    const input = e.args === undefined ? '' : shortJson(e.args)
    return [input ? `→ tool: ${name}(${input})` : `→ tool: ${name}`]
  }
  if (e.type === 'agent_end') {
    return ['result: ok']
  }
  return []
}

export class PiAgent implements ReviewAgent {
  readonly kind = 'pi' as const
  readonly displayName = 'pi'

  findExecutable(): string | null {
    return whichBinary('pi')
  }

  spawn(args: AgentSpawnArgs): AgentRunHandle {
    const { executable, prompt, workdir, sourcePath, logPath, onProgress, onOutput, onResult } =
      args
    // Prompt is fed via stdin — `pi --mode json` reads it from stdin and runs
    // headless — to avoid argv length limits with large diffs. pi has no
    // working-dir flag; it operates in cwd, so root it at the source tree like
    // claude. findings.json is written via the absolute FINDINGS_PATH the
    // prompt embeds, so cwd choice does not affect the findings write.
    const child = spawn(executable, ['--mode', 'json'], {
      cwd: sourcePath ?? workdir,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    if (child.stdin) {
      child.stdin.end(prompt)
    }

    const drained = consumeLines(child.stdout!, (line) => {
      let event: PiEvent | null = null
      try {
        const parsed: unknown = JSON.parse(line)
        if (parsed && typeof parsed === 'object') event = parsed as PiEvent
      } catch {
        // Non-JSON stdout line — ignore (mirror claude's tolerance).
      }
      if (!event || typeof event.type !== 'string') return
      onProgress(event.type, line.slice(0, 200))
      appendFileSync(logPath, line + '\n')
      if (onOutput) {
        for (const formatted of formatPiEvent(event)) onOutput(formatted)
      }
      // pi's JSON carries no success/failure field; `agent_end` just means the
      // run terminated. Treat its presence as success — the failure path is a
      // non-zero exit code, which the runner already handles.
      if (event.type === 'agent_end') {
        onResult?.({ ok: true })
      }
    })

    child.stderr?.on('data', (chunk) => appendFileSync(logPath, chunk))

    return { child, drained }
  }

  // agent.log holds newline-delimited `pi --mode json` events — the live path
  // appends exactly the lines it parses. Replaying it runs each JSON line
  // through the same formatter; non-JSON / typeless lines are skipped.
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
      const e = event as PiEvent
      if (typeof e.type !== 'string') continue
      for (const formatted of formatPiEvent(e)) out.push(formatted)
    }
    return out
  }
}
