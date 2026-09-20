// Minimal in-process sliding-window rate limiter. Zero-dependency, keyed by an arbitrary string
// (typically a userId). Its purpose is to blunt scripted abuse of sensitive Server Actions that call
// better-auth via `auth.api.*` directly — those calls bypass the HTTP router, so better-auth's own
// endpoint rate-limit middleware never runs on them (see changeOwnPassword / resetUserPassword).
//
// SCOPE / LIMITATION (deliberate, documented rather than silently assumed): the counter lives in this
// module's memory, so it is PER PROCESS. On a single-instance deployment (this app's Docker setup) that
// covers the real attack path — an attacker scripting currentPassword guesses against one running server.
// It does NOT span multiple instances or survive a restart. If this ever runs multi-instance, swap the
// Map for a shared store (Redis / DB) behind the same two functions; callers do not change.
//
// The window is a sliding log: we keep the hit timestamps inside the window and reject once the count
// reaches `limit`. `retryAfterMs` is how long until the OLDEST in-window hit ages out — i.e. the soonest
// the next attempt could succeed.

type HitLog = number[]

// Keyed by `${bucket}:${id}`. Entries self-prune on access; a periodic sweep also caps unbounded growth.
const hits = new Map<string, HitLog>()

export type RateLimitResult = { allowed: boolean; retryAfterMs: number }

// Record an attempt for `key` and report whether it is within the limit. Call this BEFORE performing the
// guarded work; a rejected call must not do the work. `now` is injectable for deterministic tests.
export function consumeRateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
  now: number = Date.now(),
): RateLimitResult {
  const cutoff = now - opts.windowMs
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff)
  if (recent.length >= opts.limit) {
    // Blocked: do NOT record this attempt (an attacker hammering must not push the window forward and
    // extend their own lockout indefinitely — the lockout should drain as the oldest hits expire).
    hits.set(key, recent)
    const oldest = recent[0] ?? now
    return { allowed: false, retryAfterMs: Math.max(0, oldest + opts.windowMs - now) }
  }
  recent.push(now)
  hits.set(key, recent)
  return { allowed: true, retryAfterMs: 0 }
}

// Clear a key's history — call after a legitimate SUCCESS so a user who fat-fingered their current
// password a couple of times, then got it right, is not left throttled.
export function resetRateLimit(key: string): void {
  hits.delete(key)
}

// Test-only: wipe all state so one test's attempts never bleed into another's.
export function __clearAllRateLimits(): void {
  hits.clear()
}
