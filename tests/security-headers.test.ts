import { describe, expect, it } from 'vitest'
import { securityHeaders } from '@/lib/security-headers'

// H2: pin the baseline security header set so a future edit can't silently drop clickjacking / MIME /
// transport protections. next.config.ts applies this array to `source: '/:path*'`.
const byKey = (key: string) =>
  securityHeaders.find((h) => h.key.toLowerCase() === key.toLowerCase())

describe('securityHeaders', () => {
  it('denies framing (anti-clickjacking)', () => {
    expect(byKey('X-Frame-Options')?.value).toBe('DENY')
    expect(byKey('Content-Security-Policy')?.value).toContain("frame-ancestors 'none'")
  })

  it('forces HTTPS via HSTS', () => {
    const hsts = byKey('Strict-Transport-Security')?.value ?? ''
    expect(hsts).toMatch(/max-age=\d+/)
    expect(hsts).toContain('includeSubDomains')
  })

  it('blocks MIME sniffing and trims referrer leakage', () => {
    expect(byKey('X-Content-Type-Options')?.value).toBe('nosniff')
    expect(byKey('Referrer-Policy')?.value).toBe('strict-origin-when-cross-origin')
  })

  it('locks down powerful features the app never uses', () => {
    const pp = byKey('Permissions-Policy')?.value ?? ''
    expect(pp).toContain('camera=()')
    expect(pp).toContain('microphone=()')
    expect(pp).toContain('geolocation=()')
  })

  it('every header has a non-empty key and value', () => {
    for (const h of securityHeaders) {
      expect(h.key.length).toBeGreaterThan(0)
      expect(h.value.length).toBeGreaterThan(0)
    }
  })
})
