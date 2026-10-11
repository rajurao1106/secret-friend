interface RateBucket {
  timestamps: number[];
}

export class OtpRateLimiter {
  readonly #buckets = new Map<string, RateBucket>();
  readonly #limit: number;
  readonly #windowMs: number;
  #calls = 0;

  constructor(limit: number, windowMs: number) {
    this.#limit = limit;
    this.#windowMs = windowMs;
  }

  consume(keys: readonly string[], now = Date.now()): boolean {
    this.#calls += 1;
    if (this.#calls % 128 === 0) {
      for (const [key, bucket] of this.#buckets) {
        bucket.timestamps = bucket.timestamps.filter(
          (timestamp) => now - timestamp < this.#windowMs,
        );
        if (bucket.timestamps.length === 0) {
          this.#buckets.delete(key);
        }
      }
    }

    const buckets = keys.map((key) => {
      const bucket = this.#buckets.get(key) ?? { timestamps: [] };
      bucket.timestamps = bucket.timestamps.filter(
        (timestamp) => now - timestamp < this.#windowMs,
      );
      return { key, bucket };
    });

    if (buckets.some(({ bucket }) => bucket.timestamps.length >= this.#limit)) {
      for (const { key, bucket } of buckets) {
        this.#buckets.set(key, bucket);
      }
      return false;
    }

    for (const { key, bucket } of buckets) {
      bucket.timestamps.push(now);
      this.#buckets.set(key, bucket);
    }
    return true;
  }
}
