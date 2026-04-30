export class RunnerRegistry {
  private cancels = new Map<string, () => Promise<void>>()

  register(id: string, cancel: () => Promise<void>): void {
    this.cancels.set(id, cancel)
  }

  unregister(id: string): void {
    this.cancels.delete(id)
  }

  isRunning(id: string): boolean {
    return this.cancels.has(id)
  }

  async cancel(id: string): Promise<void> {
    const fn = this.cancels.get(id)
    if (!fn) return
    this.cancels.delete(id)
    await fn()
  }
}
