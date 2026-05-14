import type { Readable } from 'node:stream'

// Consume a stream line-by-line, invoking onLine for each non-empty line
// (trailing whitespace trimmed). Resolves once the stream ends; any buffered
// tail without a trailing newline is flushed as a final line.
export async function consumeLines(
  stream: Readable,
  onLine: (line: string) => void,
): Promise<void> {
  let buf = ''
  for await (const chunk of stream) {
    buf += typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf8')
    let nl: number
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trimEnd()
      buf = buf.slice(nl + 1)
      if (line) onLine(line)
    }
  }
  const tail = buf.trimEnd()
  if (tail) onLine(tail)
}
