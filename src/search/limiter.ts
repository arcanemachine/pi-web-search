const MILLISECONDS_PER_MINUTE = 60_000;

export interface LimiterDecision {
  allowed: boolean;
  retryAfterMs?: number;
}

export class SearchLimiter {
  private tokens: number;
  private lastRefillAt: number | undefined;

  constructor(
    private readonly ratePerMinute: number,
    private readonly burstCapacity: number,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isFinite(ratePerMinute) || ratePerMinute <= 0) {
      throw new RangeError("ratePerMinute must be positive and finite");
    }
    if (!Number.isFinite(burstCapacity) || burstCapacity < 1) {
      throw new RangeError("burstCapacity must be at least 1 and finite");
    }
    this.tokens = burstCapacity;
  }

  acquire(): LimiterDecision {
    this.refill(this.now());
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { allowed: true };
    }

    const missingTokens = 1 - this.tokens;
    const waitMs =
      (missingTokens * MILLISECONDS_PER_MINUTE) / this.ratePerMinute;
    return {
      allowed: false,
      retryAfterMs: Math.max(1, Math.ceil(waitMs - 1e-9)),
    };
  }

  private refill(current: number): void {
    if (this.lastRefillAt === undefined) {
      this.lastRefillAt = current;
      return;
    }
    if (current <= this.lastRefillAt) return;

    const elapsedMs = current - this.lastRefillAt;
    this.tokens = Math.min(
      this.burstCapacity,
      this.tokens + (elapsedMs * this.ratePerMinute) / MILLISECONDS_PER_MINUTE,
    );
    this.lastRefillAt = current;
  }
}
