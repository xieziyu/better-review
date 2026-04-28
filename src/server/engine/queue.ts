type Task = () => Promise<void>;

interface Pending {
  key: string;
  task: Task;
  resolve: () => void;
  reject: (e: unknown) => void;
}

export class ConcurrencyQueue {
  private active = new Map<string, Promise<void>>();
  private pending: Pending[] = [];

  constructor(private maxActive: number) {}

  run(key: string, task: Task): Promise<void> {
    const existing = this.active.get(key);
    if (existing) return existing;
    if (this.active.size < this.maxActive) {
      const p = task().finally(() => {
        this.active.delete(key);
        this.drain();
      });
      this.active.set(key, p);
      return p;
    }
    return new Promise<void>((resolve, reject) => {
      this.pending.push({ key, task, resolve, reject });
    });
  }

  private drain(): void {
    while (this.active.size < this.maxActive && this.pending.length > 0) {
      const next = this.pending.shift()!;
      if (this.active.has(next.key)) {
        next.resolve();
        continue;
      }
      const p = next.task()
        .then(next.resolve, next.reject)
        .finally(() => {
          this.active.delete(next.key);
          this.drain();
        });
      this.active.set(next.key, p);
    }
  }

  pendingCount(): number {
    return this.pending.length;
  }
  activeCount(): number {
    return this.active.size;
  }
}
