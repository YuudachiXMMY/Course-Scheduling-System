import { describe, it, expect } from 'vitest'
import { parseCrossBorderAck, withCrossBorderAck } from '@/lib/report-consent'

// H3: the org's one-time cross-border AI acknowledgment is stored in organization.metadata (JSON text).
// These pin the pure parse/merge contract — no DB.

describe('parseCrossBorderAck', () => {
  it('returns null for null / empty / non-JSON metadata', () => {
    expect(parseCrossBorderAck(null)).toBeNull()
    expect(parseCrossBorderAck('')).toBeNull()
    expect(parseCrossBorderAck('not-json{')).toBeNull()
  })

  it('returns null when the ack key is absent or not a valid date', () => {
    expect(parseCrossBorderAck(JSON.stringify({ other: 'x' }))).toBeNull()
    expect(parseCrossBorderAck(JSON.stringify({ aiCrossBorderAckAt: 'nonsense' }))).toBeNull()
    expect(parseCrossBorderAck(JSON.stringify({ aiCrossBorderAckAt: 123 }))).toBeNull()
  })

  // Regression: JSON.parse can yield non-object values (string/number/array/bool). The parser must
  // runtime-narrow before indexing — a blind `as Record<...>` cast would lie about the shape.
  it('returns null for valid JSON that is not an object', () => {
    expect(parseCrossBorderAck('"just-a-string"')).toBeNull()
    expect(parseCrossBorderAck('42')).toBeNull()
    expect(parseCrossBorderAck('true')).toBeNull()
    expect(parseCrossBorderAck('null')).toBeNull()
    expect(parseCrossBorderAck(JSON.stringify(['2026-09-20T12:00:00.000Z']))).toBeNull()
  })

  it('parses a stored ISO timestamp back into a Date', () => {
    const iso = '2026-09-20T12:00:00.000Z'
    const d = parseCrossBorderAck(JSON.stringify({ aiCrossBorderAckAt: iso }))
    expect(d).toBeInstanceOf(Date)
    expect(d?.toISOString()).toBe(iso)
  })
})

describe('withCrossBorderAck', () => {
  it('stamps the ack timestamp + actor and round-trips through parse', () => {
    const at = new Date('2026-09-20T12:00:00.000Z')
    const meta = withCrossBorderAck(null, at, 'user_1')
    expect(parseCrossBorderAck(meta)?.toISOString()).toBe(at.toISOString())
    expect(JSON.parse(meta).aiCrossBorderAckBy).toBe('user_1')
  })

  it('merges into existing metadata without clobbering other keys', () => {
    const prior = JSON.stringify({ foo: 'bar', nested: { a: 1 } })
    const meta = withCrossBorderAck(prior, new Date('2026-09-20T00:00:00Z'), 'u2')
    const obj = JSON.parse(meta)
    expect(obj.foo).toBe('bar')
    expect(obj.nested).toEqual({ a: 1 })
    expect(obj.aiCrossBorderAckAt).toBeTruthy()
  })

  it('recovers from corrupt/non-object prior metadata (never loses the ack)', () => {
    for (const bad of ['not-json', JSON.stringify([1, 2, 3]), JSON.stringify('a string')]) {
      const meta = withCrossBorderAck(bad, new Date('2026-09-20T00:00:00Z'), 'u3')
      expect(parseCrossBorderAck(meta)).toBeInstanceOf(Date)
    }
  })
})
