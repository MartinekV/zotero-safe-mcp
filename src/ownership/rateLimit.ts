// SPEC Rate limit: write tools are capped per minute (sliding window over all write tools).
// Applied by the tool registry before a write tool's handler runs, so a refused call has no side effects.

export type RateLimiter = {
  /** Takes one slot if one is free. Returns null on success, else a message for the agent. */
  tryAcquire(): string | null;
};

const WINDOW_MS = 60_000;

export function createRateLimiter(opts: { perMinute(): number; now?(): number }): RateLimiter {
  const now = opts.now ?? Date.now;
  const stamps: number[] = [];
  return {
    tryAcquire() {
      const t = now();
      while (stamps.length && stamps[0] <= t - WINDOW_MS) stamps.shift();
      const cap = opts.perMinute();
      if (stamps.length >= cap) {
        const waitS = Math.max(1, Math.ceil((stamps[0] + WINDOW_MS - t) / 1000));
        return `Rate limit: at most ${cap} write calls per minute. Nothing was changed; try again in ${waitS} s.`;
      }
      stamps.push(t);
      return null;
    },
  };
}
