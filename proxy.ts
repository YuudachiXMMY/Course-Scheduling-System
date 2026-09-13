import { NextResponse, type NextRequest } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'

// SECURITY (CVE-2025-29927): UX optimization ONLY. Presence-checks the cookie (no validation).
// EVERY Server Action / Route Handler must independently call requireAuthContext()+requirePermission().
export function proxy(request: NextRequest) {
  const hasSessionCookie = getSessionCookie(request) // presence only; docs flag this as NOT secure for gating
  const isProtected = request.nextUrl.pathname.startsWith('/dashboard')
  if (isProtected && !hasSessionCookie) return NextResponse.redirect(new URL('/login', request.url))
  return NextResponse.next()
}
export const config = { matcher: ['/dashboard/:path*'] }
