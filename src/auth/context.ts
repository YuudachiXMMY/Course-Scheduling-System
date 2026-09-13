import 'server-only'
import { headers } from 'next/headers'
import { and, eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db'
import { member } from '@/db/schema'

export class AuthError extends Error {
  constructor(public code: 'UNAUTHENTICATED' | 'NO_ACTIVE_ORG' | 'NOT_A_MEMBER' | 'FORBIDDEN') {
    super(code)
    this.name = 'AuthError'
  }
}
export interface AuthContext {
  userId: string
  tenantId: string
  role: string
  isPlatformAdmin: boolean
}

export async function getAuthContext(): Promise<AuthContext | null> {
  // H2: authz depends on session.user.role (isPlatformAdmin) and on the session still existing in
  // the DB. Bypass the 5-min cookieCache so a demoted (setRole) or banned (session deleted) user
  // loses access immediately instead of coasting on a signed cache cookie. We already hit the DB
  // for the member row every request, so this adds no meaningful cost.
  const session = await auth.api.getSession({
    headers: await headers(), // async headers() in Next 16
    query: { disableCookieCache: true },
  })
  if (!session?.session) return null
  const tenantId = session.session.activeOrganizationId
  if (!tenantId) return null
  // Re-derive role from the DB member row (a stale/forged cookie cannot grant access):
  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, tenantId), eq(member.userId, session.user.id)))
    .limit(1)
  if (!m) return null
  return {
    userId: session.user.id,
    tenantId,
    role: m.role,
    isPlatformAdmin: (session.user.role ?? '').split(',').includes('superadmin'),
  }
}
export async function requireAuthContext(): Promise<AuthContext> {
  const ctx = await getAuthContext()
  if (!ctx) throw new AuthError('UNAUTHENTICATED')
  return ctx
}
