import 'server-only'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { member, user } from '@/db/schema'
import { STAFF_ROLES } from '@/auth/roles'
import type { AuthContext } from '@/auth/context'

export interface TeacherOption {
  id: string // Better Auth user id (== classSection.teacherId)
  name: string
}

// CR2: the org members a whole-tenant actor may assign as a section's teacher. classSection.teacherId
// is an auth-owned user id (no Drizzle FK), so this joins member ↔ user on the RAW db — member/user are
// auth-owned tables, NOT tenant tables, so forTenant() does not apply. Scope by organizationId ===
// ctx.tenantId (the same predicate createSection uses to verify an assigned teacher). Any staff role can
// hold/teach a section (owner/admin/teacher/assistant), so every staff member of the org is assignable;
// portal roles (parent/student) are excluded. Deduped by user id (member is unique per (org,user) but
// role may be comma-multi). The server (createSection, actions.ts:273-282) re-validates membership, so
// this list is only UI convenience, never the authority.
export async function listTeachers(ctx: AuthContext): Promise<TeacherOption[]> {
  const rows = await db
    .select({ userId: member.userId, name: user.name, role: member.role })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, ctx.tenantId))

  const isStaff = (role: string) =>
    role
      .split(',')
      .map((r) => r.trim())
      .some((r) => (STAFF_ROLES as readonly string[]).includes(r))

  const seen = new Set<string>()
  const out: TeacherOption[] = []
  for (const r of rows) {
    if (!isStaff(r.role) || seen.has(r.userId)) continue
    seen.add(r.userId)
    out.push({ id: r.userId, name: r.name })
  }
  return out
}
