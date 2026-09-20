// H2: baseline security response headers applied to every route in next.config.ts. Deliberately a
// SAFE subset that cannot break Next's runtime:
//   - No CSP `default-src`/`script-src`/`style-src` — those would require per-request nonces for
//     Next's inline hydration/bootstrap scripts, and getting them wrong white-screens the whole app.
//     We ship only the CSP directives that carry no such risk (frame-ancestors / base-uri / object-src).
//   - HSTS is ignored by browsers when received over plain HTTP, so it is safe to send unconditionally
//     even though compose can expose port 3000 over HTTP behind a TLS-terminating proxy.
// Concrete threats closed: clickjacking of staff Server-Action pages (X-Frame-Options + frame-ancestors)
// and first-visit HTTP->HTTPS downgrade on subsequent visits (HSTS). MIME sniffing, referrer leakage,
// and unused powerful features are locked down as defense-in-depth.
export interface SecurityHeader {
  key: string
  value: string
}

export const securityHeaders: SecurityHeader[] = [
  // Force HTTPS on subsequent visits. includeSubDomains covers the app's own subdomains; drop it if a
  // sibling subdomain is intentionally served over HTTP.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  // No page in this app is meant to be framed by anyone → hard-deny framing (anti-clickjacking).
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // The app uses none of these powerful features; deny them so a future XSS can't reach for them.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  },
  // CSP: only the runtime-safe directives (no script/style/default-src — see file header).
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  },
]
