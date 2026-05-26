type Task = () => Promise<void>

interface Pending {
  key: string
  task: Task
  resolve: () => void
  reject: (e: unknown) => void
}

export class ConcurrencyQueue {
  private active = new Map<string, Promise<void>>()
  private pending: Pending[] = []
  private quiesceWaiters: Array<() => void> = []

  constructor(private maxActive: number) {}

  run(key: string, task: Task): Promise<void> {
    const existing = this.active.get(key)
    if (existing) return existing
    if (this.active.size < this.maxActive) {
      const p = task().finally(() => {
        this.active.delete(key)
        this.drain()
      })
      this.active.set(key, p)
      return p
    }
    return new Promise<void>((resolve, reject) => {
      this.pending.push({ key, task, resolve, reject })
    })
  }

  private drain(): void {
    while (this.active.size < this.maxActive && this.pending.length > 0) {
      const next = this.pending.shift()!
      if (this.active.has(next.key)) {
        next.resolve()
        continue
      }
      const p = next
        .task()
        .then(next.resolve, next.reject)
        .finally(() => {
          this.active.delete(next.key)
          this.drain()
        })
      this.active.set(next.key, p)
    }
    if (this.active.size === 0 && this.pending.length === 0 && this.quiesceWaiters.length > 0) {
      const waiters = this.quiesceWaiters
      this.quiesceWaiters = []
      for (const w of waiters) w()
    }
  }

  // Resolves when the queue has no active or pending work, or after
  // `timeoutMs` if provided. Used at daemon shutdown so in-flight
  // start-session promises finish writing their final status rows before
  // the DB is closed.
  quiesce(timeoutMs?: number): Promise<void> {
    if (this.active.size === 0 && this.pending.length === 0) return Promise.resolve()
    return new Promise<void>((resolve) => {
      let resolved = false
      const wake = (): void => {
        if (resolved) return
        resolved = true
        resolve()
      }
      this.quiesceWaiters.push(wake)
      if (timeoutMs !== undefined) {
        const t = setTimeout(wake, timeoutMs)
        // Don't keep the event loop alive just for the timeout — if the
        // process is otherwise idle, shutdown can complete immediately.
        if (typeof t.unref === 'function') t.unref()
      }
    })
  }

  pendingCount(): number {
    return this.pending.length
  }
  activeCount(): number {
    return this.active.size
  }

  drop(key: string): void {
    const remaining: Pending[] = []
    for (const p of this.pending) {
      if (p.key === key) {
        p.resolve()
      } else {
        remaining.push(p)
      }
    }
    this.pending = remaining
  }
}
