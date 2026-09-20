import { describe, it, expect, beforeEach } from 'vitest'
import { consumeRateLimit, resetRateLimit, __clearAllRateLimits } from '@/lib/rate-limit'

// Pure in-process sliding-window limiter (src/lib/rate-limit.ts). `now` is injectable so the window is
// tested deterministically without real timers. Guards the sensitive password Server Actions, whose
// auth.api.* calls bypass better-auth's HTTP rate-limit middleware.

beforeEach(() => {
  __clearAllRateLimits()
})

const OPTS = { limit: 3, windowMs: 1000 }

describe('consumeRateLimit — sliding window', () => {
  it('allows attempts up to the limit, then blocks', () => {
    expect(consumeRateLimit('k', OPTS, 0).allowed).toBe(true)
    expect(consumeRateLimit('k', OPTS, 10).allowed).toBe(true)
    expect(consumeRateLimit('k', OPTS, 20).allowed).toBe(true)
    const blocked = consumeRateLimit('k', OPTS, 30)
    expect(blocked.allowed).toBe(false)
    // retryAfter = oldest hit (t=0) + window (1000) - now (30) = 970
    expect(blocked.retryAfterMs).toBe(970)
  })

  it('keeps separate windows per key', () => {
    consumeRateLimit('a', OPTS, 0)
    consumeRateLimit('a', OPTS, 0)
    consumeRateLimit('a', OPTS, 0)
    expect(consumeRateLimit('a', OPTS, 0).allowed).toBe(false)
    // a different key is untouched
    expect(consumeRateLimit('b', OPTS, 0).allowed).toBe(true)
  })

  it('lets attempts through again once the oldest hits age out of the window', () => {
    consumeRateLimit('k', OPTS, 0)
    consumeRateLimit('k', OPTS, 100)
    consumeRateLimit('k', OPTS, 200)
    expect(consumeRateLimit('k', OPTS, 300).allowed).toBe(false)
    // at t=1001 the first hit (t=0) has expired → one slot frees up
    expect(consumeRateLimit('k', OPTS, 1001).allowed).toBe(true)
  })

  it('a blocked attempt does not push the window forward (lockout drains, not extends)', () => {
    consumeRateLimit('k', OPTS, 0)
    consumeRateLimit('k', OPTS, 0)
    consumeRateLimit('k', OPTS, 0)
    // hammer while blocked
    consumeRateLimit('k', OPTS, 500)
    consumeRateLimit('k', OPTS, 900)
    // still governed by the original three hits at t=0 → all expire at t=1000
    expect(consumeRateLimit('k', OPTS, 1001).allowed).toBe(true)
  })

  it('resetRateLimit clears a key so the next attempt is allowed immediately', () => {
    consumeRateLimit('k', OPTS, 0)
    consumeRateLimit('k', OPTS, 0)
    consumeRateLimit('k', OPTS, 0)
    expect(consumeRateLimit('k', OPTS, 0).allowed).toBe(false)
    resetRateLimit('k')
    expect(consumeRateLimit('k', OPTS, 0).allowed).toBe(true)
  })
})
