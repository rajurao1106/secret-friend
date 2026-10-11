interface QueuedJob {
  readonly key: string;
  readonly run: () => Promise<void>;
  readonly onError: (error: unknown) => void;
}

export class KundaliMatchQueue {
  readonly #pending = new Set<string>();
  readonly #jobs: QueuedJob[] = [];
  readonly #maxQueued: number;
  #running = false;

  constructor(maxQueued = 100) {
    this.#maxQueued = maxQueued;
  }

  enqueue(key: string, run: () => Promise<void>, onError: (error: unknown) => void): boolean {
    if (this.#pending.has(key)) return true;
    if (this.#jobs.length >= this.#maxQueued) return false;
    this.#pending.add(key);
    this.#jobs.push({ key, run, onError });
    void this.#drain();
    return true;
  }

  async #drain(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      while (this.#jobs.length > 0) {
        const job = this.#jobs.shift();
        if (job === undefined) continue;
        try {
          await job.run();
        } catch (error: unknown) {
          job.onError(error);
        } finally {
          this.#pending.delete(job.key);
        }
      }
    } finally {
      this.#running = false;
    }
  }
}
