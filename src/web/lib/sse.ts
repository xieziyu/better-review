import type { SSEEvent } from '@shared/types'
import { useEffect } from 'react'

const SSE_TYPES: Array<SSEEvent['type']> = [
  'progress',
  'finding-added',
  'finding-updated',
  'status-changed',
  'error',
  'done',
  'shutting-down',
]

export function useSSE(path: string, onEvent: (e: SSEEvent) => void): void {
  useEffect(() => {
    const es = new EventSource(path)
    const handler = (ev: MessageEvent) => {
      try {
        onEvent(JSON.parse(ev.data) as SSEEvent)
      } catch {
        /* ignore malformed payloads */
      }
    }
    SSE_TYPES.forEach((t) => es.addEventListener(t, handler as EventListener))
    return () => es.close()
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [path])
}
