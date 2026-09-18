import { describe, it, expect } from 'vitest'
import { issueConfirmation, consumeConfirmation, confirmationStoreSize } from '@/lib/mcp-confirm'

// SEC6: the confirmation-token store only shrank on consume, so a preview that was never confirmed
// leaked forever. issueConfirmation now lazily sweeps expired entries. `now` is injectable so the
// clock is deterministic.
const TTL_MS = 5 * 60_000

describe('mcp-confirm SEC6 — 过期确认令牌惰性清理', () => {
  it('签发新令牌时清理已过期的条目（真正从 store 删除，而非仅拒绝）', () => {
    const base = 1_000_000
    const payloadA = { tool: 'a', n: 1 }
    const baseline = confirmationStoreSize()

    const t1 = issueConfirmation(payloadA, base) // expires at base + TTL
    expect(confirmationStoreSize()).toBe(baseline + 1)

    // Issue another AFTER t1 has expired → the lazy sweep purges t1 before adding t2.
    const t2 = issueConfirmation({ tool: 'b' }, base + TTL_MS + 1)
    expect(confirmationStoreSize()).toBe(baseline + 1) // t1 gone, t2 added → net +1

    // t1 is truly removed (would still be rejected on expiry, but here it isn't even present)
    expect(consumeConfirmation(t1, payloadA, base + TTL_MS + 1)).toBe(false)
    // t2 remains valid within its own TTL
    expect(consumeConfirmation(t2, { tool: 'b' }, base + TTL_MS + 2)).toBe(true)
  })

  it('未过期条目不会被清理', () => {
    const base = 5_000_000
    const baseline = confirmationStoreSize()
    const t1 = issueConfirmation({ x: 1 }, base)
    const t2 = issueConfirmation({ x: 2 }, base + 1000) // both well within TTL
    expect(confirmationStoreSize()).toBe(baseline + 2)
    expect(consumeConfirmation(t1, { x: 1 }, base + 2000)).toBe(true)
    expect(consumeConfirmation(t2, { x: 2 }, base + 2000)).toBe(true)
  })
})
