import type { SSEEvent } from '../../shared/types'

type Handler = (e: SSEEvent) => void

export class EventBus {
  private sessionHandlers = new Map<string, Set<Handler>>()
  private globalHandlers = new Set<Handler>()

  subscribeSession(sessionId: string, h: Handler): () => void {
    let set = this.sessionHandlers.get(sessionId)
    if (!set) {
      set = new Set()
      this.sessionHandlers.set(sessionId, set)
    }
    set.add(h)
    return () => {
      set!.delete(h)
      if (set!.size === 0) this.sessionHandlers.delete(sessionId)
    }
  }

  subscribeGlobal(h: Handler): () => void {
    this.globalHandlers.add(h)
    return () => {
      this.globalHandlers.delete(h)
    }
  }

  emit(event: SSEEvent): void {
    if ('sessionId' in event && event.sessionId) {
      const set = this.sessionHandlers.get(event.sessionId)
      set?.forEach((h) => {
        try {
          h(event)
        } catch {
          /* swallow */
        }
      })
    }
    this.globalHandlers.forEach((h) => {
      try {
        h(event)
      } catch {
        /* swallow */
      }
    })
  }
}
