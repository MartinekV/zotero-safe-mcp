// The write rate limiter used by POST /safe-mcp, reading its cap from prefs on every call.
import { DEFAULT_WRITES_PER_MINUTE, WRITES_PER_MINUTE_PREF } from "../config";
import { createRateLimiter, type RateLimiter } from "./rateLimit";

/** The pref if it is a positive integer, else the default (a broken pref never disables the limit). */
export function writesPerMinute(): number {
  const v = Zotero.Prefs.get(WRITES_PER_MINUTE_PREF, true);
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : DEFAULT_WRITES_PER_MINUTE;
}

export function prefWriteLimiter(): RateLimiter {
  return createRateLimiter({ perMinute: writesPerMinute });
}
