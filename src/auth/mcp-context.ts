import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { member, user } from '@/db/schema'
import { AuthError, type AuthContext } from '@/auth/context'
import { env } from '@/env'

// P6-1: MCP has no Better Auth session. Build the SAME AuthContext the web app uses from the
// env-configured owner, RE-DERIVING role from the live member row (mirrors getAuthContext in
// context.ts) so a demoted, removed, or banned principal loses access immediately. This is an alternate
// PRINCIPAL SOURCE — not a raw-db exception: every MCP tool still goes through requirePermission
// + forTenant(ctx) unchanged (M1 preserved).
//
// tenantId/userId come ONLY from server env (never from tool arguments). isPlatformAdmin is
// ALWAYS false — an MCP token must never get cross-tenant god-mode.

// Given a (userId, tenantId), re-derive role from the live member row and build the AuthContext.
// Split out from resolveMcpAuthContext so it is directly testable without stubbing env.
export async function mcpAuthContextFor(userId: string, tenantId: string): Promise<AuthContext> {
  const [m] = await db
    .select({ role: member.role, banned: user.banned, banExpires: user.banExpires })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(and(eq(member.organizationId, tenantId), eq(member.userId, userId)))
    .limit(1)
  if (!m) throw new AuthError('NOT_A_MEMBER')
  // B1 (orch-review HIGH): the MCP static-bearer channel has NO Better Auth session, so account
  // deactivation — which flips the GLOBAL user.banned and deletes sessions (see deactivateStaffCore) — is
  // invisible here unless we check it ourselves. Better Auth only enforces `banned` at login
  // (session.create.before), so without this a deactivated/banned principal configured as MCP_USER_ID
  // keeps full MCP access (student PII, scheduling, notes, share links) until an operator manually edits
  // env + restarts. Mirror Better Auth's ban semantics exactly: it treats a ban as expired only once
  // `banExpires < now`, so a ban is ACTIVE when banned=true and it has no expiry OR its expiry has not yet
  // passed (`banExpires >= now`). deactivateStaffCore writes banExpires=null (the permanent-ban path).
  if (m.banned && (!m.banExpires || m.banExpires.getTime() >= Date.now())) {
    throw new AuthError('FORBIDDEN')
  }
  return { userId, tenantId, role: m.role, isPlatformAdmin: false }
}

export async function resolveMcpAuthContext(): Promise<AuthContext> {
  const userId = env.MCP_USER_ID
  const tenantId = env.MCP_ORG_ID
  if (!userId || !tenantId) {
    // Fail fast with a clear, non-leaky code when the connector principal isn't configured.
    throw new AuthError('NO_ACTIVE_ORG')
  }
  return mcpAuthContextFor(userId, tenantId)
}
