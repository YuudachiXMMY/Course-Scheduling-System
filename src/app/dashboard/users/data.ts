import 'server-only'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { member, user, portalLink, student } from '@/db/schema'
import { forTenant } from '@/db/tenant'
import { isPortalRole } from '@/auth/portal'
import type { AuthContext } from '@/auth/context'

export type PortalUserRow = {
  userId: string
  name: string
  email: string
  role: string
  createdAt: Date
  updatedAt: Date
  students: { id: string; name: string }[]
}

// List every portal login (parent/student) in the tutor's org, each with the students it is linked to.
// member is NOT a tenant table (keyed by organizationId, which equals tenantId here), so it is queried
// directly (not via forTenant). portalLink/student ARE tenant tables and go through forTenant.
//
// `opts.kind` splits the list by tab: the 家长 tab passes 'parent' and the 学生 tab passes 'student', so a
// pure-student login never leaks into 家长 (the reported bug). The filter is comma-multi aware — a rare
// 'parent,student' account matches BOTH kinds (it genuinely belongs on both tabs). Omit opts to get every
// portal login unfiltered (the students-tab assign picker still offers all logins to link).
export async function listPortalUsers(
  ctx: AuthContext,
  opts?: { kind?: 'parent' | 'student' },
): Promise<PortalUserRow[]> {
  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      role: member.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, ctx.tenantId))
  // member.role may be a comma-separated multi-role string ('parent,student'), so filter in JS via
  // isPortalRole — an inArray(member.role, [...]) would miss the composite values. When opts.kind is set,
  // narrow to accounts whose parsed role list contains that kind (same comma-multi parsing).
  const portalUsers = rows.filter((r) => {
    if (!isPortalRole(r.role)) return false
    if (!opts?.kind) return true
    return r.role
      .split(',')
      .map((x) => x.trim())
      .includes(opts.kind)
  })
  if (portalUsers.length === 0) return []

  const links = await forTenant(ctx).select(portalLink)
  const students = await forTenant(ctx).select(student)
  const nameById = new Map(students.map((s) => [s.id, s.name]))
  const linksByUser = new Map<string, { id: string; name: string }[]>()
  for (const l of links) {
    const name = nameById.get(l.studentId)
    if (!name) continue // archived/removed student → skip
    const arr = linksByUser.get(l.userId) ?? []
    arr.push({ id: l.studentId, name })
    linksByUser.set(l.userId, arr)
  }
  return portalUsers.map((u) => ({ ...u, students: linksByUser.get(u.userId) ?? [] }))
}

export type StaffRow = {
  userId: string
  name: string
  email: string
  role: string
  banned: boolean
  createdAt: Date
  updatedAt: Date
}

// List every STAFF login (owner/admin/teacher/assistant) in the org — the inverse of listPortalUsers.
// Same member-direct query (member is keyed by organizationId = tenantId), filtered by `!isPortalRole`
// so a comma-multi role is classified correctly (an inArray on member.role would miss composites). The
// `banned` flag drives the 停用/启用 control on the teachers/admins tabs.
export async function listStaff(ctx: AuthContext): Promise<StaffRow[]> {
  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      role: member.role,
      banned: user.banned,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, ctx.tenantId))
  return rows.filter((r) => !isPortalRole(r.role)).map((r) => ({ ...r, banned: r.banned ?? false }))
}
