/** IP ごとの回数制限（直近 windowMs のあいだに limit 回まで） */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  private recent(key: string): number[] {
    const t = this.now();
    const list = (this.hits.get(key) ?? []).filter(
      (x) => t - x < this.windowMs,
    );
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  isBlocked(key: string): boolean {
    return this.recent(key).length >= this.limit;
  }

  hit(key: string): void {
    const list = this.recent(key);
    list.push(this.now());
    this.hits.set(key, list);
  }

  /** 古い記録を捨てる（定期的に呼ぶ） */
  prune(): void {
    for (const key of [...this.hits.keys()]) this.recent(key);
  }
}
