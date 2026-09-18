import { describe, it, expect } from 'vitest'
import { qrDataUrl } from '@/lib/qr'

// P4-11: qrDataUrl wraps `qrcode` to encode the PUBLIC share URL. `server-only` is aliased to an empty
// stub by vitest.config.ts, so this pure wrapper is unit-testable without an RSC graph. These tests pin
// the contract callers rely on: a PNG data URL, deterministic for a given input, and distinct per input.
describe('qrDataUrl', () => {
  it('returns a base64 PNG data URL for a valid https URL', async () => {
    const out = await qrDataUrl('https://example.com/s/abc123')
    expect(out).toMatch(/^data:image\/png;base64,/)
    // Non-trivial payload — a 220px H-correction QR is well over a few hundred base64 chars.
    expect(out.length).toBeGreaterThan(200)
  })

  it('is deterministic — identical input yields byte-identical output', async () => {
    const url = 'https://example.com/s/deterministic'
    const [a, b] = await Promise.all([qrDataUrl(url), qrDataUrl(url)])
    expect(a).toBe(b)
  })

  it('encodes different URLs to different images', async () => {
    const a = await qrDataUrl('https://example.com/s/one')
    const b = await qrDataUrl('https://example.com/s/two')
    expect(a).not.toBe(b)
  })

  it('rejects an empty string (qrcode requires input text)', async () => {
    await expect(qrDataUrl('')).rejects.toThrow(/No input text/)
  })
})
