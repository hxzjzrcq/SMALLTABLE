/** Bounded token buckets. Keys are remote transport addresses, never untrusted headers. */
export class Limiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(
    private capacity: number,
    private perSecond: number,
  ) {}
  take(key: string, now = Date.now()) {
    if (this.buckets.size > 10000)
      for (const [k, b] of this.buckets) if (now - b.at > 60000) this.buckets.delete(k);
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.at) / 1000) * this.perSecond);
    b.at = now;
    const ok = b.tokens >= 1;
    if (ok) b.tokens--;
    this.buckets.set(key, b);
    return ok;
  }
}
