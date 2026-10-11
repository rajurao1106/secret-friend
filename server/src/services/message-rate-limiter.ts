export class MessageRateLimiter {
  readonly #timestamps = new Map<string, number[]>();

  allow(userId: string, now = Date.now()): boolean {
    const recent = (this.#timestamps.get(userId) ?? []).filter(
      (timestamp) => now - timestamp < 10_000,
    );
    if (recent.length >= 20) {
      this.#timestamps.set(userId, recent);
      return false;
    }

    recent.push(now);
    this.#timestamps.set(userId, recent);
    return true;
  }
}
