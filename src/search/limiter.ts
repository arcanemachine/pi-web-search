export interface LimiterDecision {
  allowed: boolean;
  retryAfterMs?: number;
}

export class SearchLimiter {
  private lastDispatchAt: number | undefined;

  constructor(
    private readonly minIntervalMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  acquire(): LimiterDecision {
    const current = this.now();
    if (this.lastDispatchAt !== undefined) {
      const elapsed = current - this.lastDispatchAt;
      if (elapsed < this.minIntervalMs) {
        return {
          allowed: false,
          retryAfterMs: Math.max(0, this.minIntervalMs - elapsed),
        };
      }
    }
    this.lastDispatchAt = current;
    return { allowed: true };
  }
}
