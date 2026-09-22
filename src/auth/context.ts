import 'server-only'
import { headers } from 'next/headers'
import { and, asc, eq } from 'drizzle-orm'
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
  const userId = session.user.id
  const activeOrgId = session.session.activeOrganizationId

  // Re-derive tenant + role from the DB member row (a stale/forged cookie can never grant access —
  // we only ever return an org the user genuinely has a member row in).
  //
  // Self-heal for the sign-up race: on /sign-up/email, Better Auth persists the new session a few ms
  // BEFORE the user.create.after hook (auth.ts) commits the org + owner member, so session.create.before
  // finds no membership yet and writes activeOrganizationId=null. That first session would otherwise be
  // stranded on /login forever (the dashboard/portal layouts bounce a null context). When the session
  // carries no active org, fall back to the user's default membership so a freshly-signed-up owner still
  // gets in. Verified via DB timestamps: the session row precedes the member row on sign-up.
  const [m] = activeOrgId
    ? await db
        .select({ tenantId: member.organizationId, role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, activeOrgId), eq(member.userId, userId)))
        .limit(1)
    : // L-auth: deterministic fallback for a multi-org user whose session carries no active org (the
      // sign-up self-heal path). Without ORDER BY, Postgres could return ANY membership row — landing the
      // user in an unintended tenant/role. Order by createdAt so it is always the earliest (default) org.
      await db
        .select({ tenantId: member.organizationId, role: member.role })
        .from(member)
        .where(eq(member.userId, userId))
        .orderBy(asc(member.createdAt))
        .limit(1)
  if (!m) return null
  return {
    userId,
    tenantId: m.tenantId,
    role: m.role,
    isPlatformAdmin: (session.user.role ?? '').split(',').includes('superadmin'),
  }
}
export async function requireAuthContext(): Promise<AuthContext> {
  const ctx = await getAuthContext()
  if (!ctx) throw new AuthError('UNAUTHENTICATED')
  return ctx
}
