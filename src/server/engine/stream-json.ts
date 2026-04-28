import type { Readable } from 'node:stream'

export type StreamEvent = Record<string, unknown> & { type: string }

export async function parseStreamJson(
  stream: Readable,
  onEvent: (e: StreamEvent) => void,
  onError?: (err: string) => void,
): Promise<void> {
  let buf = ''
  for await (const chunk of stream) {
    buf += typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf8')
    let nl: number
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      try {
        onEvent(JSON.parse(line) as StreamEvent)
      } catch (e) {
        onError?.(`stream-json parse error: ${(e as Error).message} on line: ${line.slice(0, 200)}`)
      }
    }
  }
  const tail = buf.trim()
  if (tail) {
    try {
      onEvent(JSON.parse(tail) as StreamEvent)
    } catch (e) {
      onError?.(`stream-json tail parse error: ${(e as Error).message}`)
    }
  }
}
