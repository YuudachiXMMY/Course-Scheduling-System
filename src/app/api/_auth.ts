import { AuthError } from '@/auth/context'

// EH3: shared AuthError → HTTP Response mapper for the authenticated API routes (report/export).
// requireAuthContext throws AuthError('UNAUTHENTICATED') and requirePermission throws
// AuthError('FORBIDDEN') at the top of each route; without handling, both escape the handler and
// Next.js returns HTTP 500 instead of the correct 401/403. Each route wraps its body in try/catch:
//   catch (e) { const r = authErrorResponse(e); if (r) return r; throw e }
// A non-AuthError (or an unmapped code) returns null so it is re-thrown and still surfaces as a
// genuine 500. Mirrors the AuthError→text mapping in mcp/register-tools.ts.
export function authErrorResponse(e: unknown): Response | null {
  if (!(e instanceof AuthError)) return null
  switch (e.code) {
    case 'UNAUTHENTICATED':
      return new Response('未认证', { status: 401 })
    case 'FORBIDDEN':
    case 'NO_ACTIVE_ORG':
    case 'NOT_A_MEMBER':
      return new Response('无权访问', { status: 403 })
    default:
      return null
  }
}
