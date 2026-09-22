// H6: share/calendar capability tokens must not live forever. Pure, client-safe (no server-only, no DB)
// so it stays unit-testable and can be imported from any layer (mirrors the B2 client-safe boundary of
// other lib helpers). Semantics: a NULL expiry means "never expires" — existing tokens issued before
// this change carry NULL and stay valid (backward-compatible); only newly issued/rotated tokens get a
// TTL from defaultShareExpiry().

// 180 days: generous enough that a parent's long-lived calendar subscription isn't culled mid-term,
// while still bounding the lifetime of a forwarded/leaked link. Opening the share panel renews it.
export const SHARE_TOKEN_TTL_DAYS = 180

const DAY_MS = 86_400_000

export function defaultShareExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + SHARE_TOKEN_TTL_DAYS * DAY_MS)
}

// NULL expiry → active forever (grandfathered). A concrete expiry is active only while strictly in the
// future; exactly-now counts as expired.
export function isTokenTimeActive(expiresAt: Date | null, now: Date = new Date()): boolean {
  return expiresAt === null || expiresAt.getTime() > now.getTime()
}
