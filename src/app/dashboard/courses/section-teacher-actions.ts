'use server'

import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { requireAuthContext, AuthError } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { actorOwnsSection } from '@/auth/scope'
import { db } from '@/db'
import { forTenant } from '@/db/tenant'
import { classSection, sectionTeacher, member, user } from '@/db/schema'
import { STAFF_ROLES } from '@/auth/roles'
import { isUniqueViolation, toPortalActionError } from '@/lib/errors'

// 多教师/助教 — an admin assigns MULTIPLE teachers/assistants to a section from 班级设置. section_teacher is
// the authoritative access set (src/auth/scope.ts); classSection.teacherId is kept as the PRIMARY teacher
// (drives lesson.teacherId denormalization on materialize + calendar display) and is maintained here so it
// always points at a current member (or null when the section has none).
//
// Business errors are RETURNED as data (not thrown) so Chinese messages survive Next.js's production
// redaction of thrown Server-Action messages (React #441) — mirrors courses/actions.ts.

export interface SectionTeacherRow {
  userId: string
  name: string
  role: string // the member's (comma-multi) org role — for the 教师/助教 label
  isPrimary: boolean // classSection.teacherId === userId
}
export type SectionTeacherResult = { ok: true } | { ok: false; error: string }

const assignSchema = z.object({
  sectionId: z.string().trim().min(1),
  userId: z.string().trim().min(1),
})

const isStaff = (role: string) =>
  role
    .split(',')
    .map((r) => r.trim())
    .some((r) => (STAFF_ROLES as readonly string[]).includes(r))

// READ: the staff currently linked to a section, with names/roles for the settings panel. Gated on
// course:read + section ownership so a section-scoped teacher/assistant may VIEW (read-only) the roster of
// teachers on a section they belong to, and never probe a foreign section. Whole-tenant staff see any.
export async function listSectionTeachers(sectionId: string): Promise<SectionTeacherRow[]> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { course: ['read'] })

  // Load the section ONCE and authorize against the loaded row. actorOwnsSectionById would re-fetch the
  // same classSection row (findById) internally, so pairing it with the load below was a duplicate query.
  const section = await forTenant(ctx).findById(classSection, sectionId)
  if (!section || !(await actorOwnsSection(ctx, section))) return []

  const links = await forTenant(ctx).select(sectionTeacher, eq(sectionTeacher.sectionId, sectionId))
  const primaryId = section.teacherId ?? null
  // 多教师(hybrid): the roster is every LINKED userId UNION the PRIMARY teacher — the primary owns the
  // section even without an explicit link row (createSection seeds one, but stay robust to drift), so the
  // panel must always surface them. Deduped.
  const userIds = [...new Set([...links.map((l) => l.userId), ...(primaryId ? [primaryId] : [])])]
  if (userIds.length === 0) return []

  // Names/roles come from member ⋈ user on the RAW db (member/user are auth-owned, no tenant column on
  // user). Scope by organizationId === ctx.tenantId — the same join listTeachers uses. Kept sequential
  // AFTER the userIds short-circuit above (not folded into a Promise.all) so an empty roster skips it.
  const members = await db
    .select({ userId: member.userId, name: user.name, role: member.role })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, ctx.tenantId))
  const byId = new Map(members.map((m) => [m.userId, { name: m.name, role: m.role }]))

  return userIds
    .map((uid) => {
      const m = byId.get(uid)
      return {
        userId: uid,
        name: m?.name ?? '(已离职账号)',
        role: m?.role ?? '',
        isPrimary: uid === primaryId,
      }
    })
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name, 'zh'))
}

// WRITE: add a teacher/assistant to a section. Only org managers (owner/admin — the only holders of
// course:update after the 多教师 change) may do this. Idempotent: a re-add is a no-op. If the section had
// no primary teacher, the first added member becomes it (so materialize/display have a teacher to point at).
export async function addSectionTeacher(
  input: z.input<typeof assignSchema>,
): Promise<SectionTeacherResult> {
  const ctx = await requireAuthContext()
  try {
    requirePermission(ctx, { course: ['update'] })
    const { sectionId, userId } = assignSchema.parse(input)

    // The section must belong to this tenant (findById is tenant-scoped) — a clean error, and the FK would
    // reject a foreign section anyway.
    const section = await forTenant(ctx).findById(classSection, sectionId)
    if (!section) return { ok: false, error: '班级不存在或不属于当前机构' }

    // The target must be a STAFF member of THIS org (never trust a client-supplied userId — section_teacher
    // has no FK on userId, mirroring classSection.teacherId's B8 guard). Portal (parent/student) rejected.
    const [m] = await db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, ctx.tenantId)))
      .limit(1)
    if (!m || !isStaff(m.role)) return { ok: false, error: '该用户不是当前机构的教师/助教' }

    // Idempotent add: insert directly and let the uq_section_teacher_section_user unique index arbitrate.
    // A select-then-insert pre-check had a TOCTOU window — two concurrent re-adds could both pass the check
    // and the loser hit a raw 23505, leaking a Postgres error to the admin UI. Swallow the unique violation
    // as an idempotent no-op success instead (mirrors the quick-grade upsert recovery in teach/data.ts).
    try {
      await forTenant(ctx).insert(sectionTeacher, { sectionId, userId })
    } catch (e) {
      if (!isUniqueViolation(e)) throw e
    }
    // Fill an empty primary so the section always has a teacher for lesson denormalization / display.
    if (!section.teacherId) {
      await forTenant(ctx).update(classSection, sectionId, { teacherId: userId })
    }
    revalidatePath('/dashboard/teach/' + sectionId)
    revalidatePath('/dashboard/courses')
    return { ok: true }
  } catch (e) {
    // CWE-209: keep the specific auth message, but never forward a raw internal (Zod/DB fault) .message —
    // toPortalActionError forwards only KNOWN Business/Conflict messages and logs+collapses the rest.
    if (e instanceof AuthError) return { ok: false, error: '无权管理该班级的教师' }
    return toPortalActionError(e, '添加教师失败')
  }
}

// WRITE: remove a teacher/assistant from a section (revokes their access). If the removed member was the
// PRIMARY teacher, promote another remaining member to primary, or clear it when none remain.
export async function removeSectionTeacher(
  input: z.input<typeof assignSchema>,
): Promise<SectionTeacherResult> {
  const ctx = await requireAuthContext()
  try {
    requirePermission(ctx, { course: ['update'] })
    const { sectionId, userId } = assignSchema.parse(input)

    const section = await forTenant(ctx).findById(classSection, sectionId)
    if (!section) return { ok: false, error: '班级不存在或不属于当前机构' }

    const rows = await forTenant(ctx).select(
      sectionTeacher,
      and(eq(sectionTeacher.sectionId, sectionId), eq(sectionTeacher.userId, userId)),
    )
    for (const r of rows) await forTenant(ctx).delete(sectionTeacher, r.id)

    // Keep classSection.teacherId pointing at a CURRENT member: if we just removed the primary, promote the
    // earliest-remaining link (deterministic by createdAt), else null so materialize won't reuse a stale id.
    if (section.teacherId === userId) {
      const remaining = await forTenant(ctx).select(
        sectionTeacher,
        eq(sectionTeacher.sectionId, sectionId),
      )
      const next = remaining.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]
      await forTenant(ctx).update(classSection, sectionId, { teacherId: next?.userId ?? null })
    }
    revalidatePath('/dashboard/teach/' + sectionId)
    revalidatePath('/dashboard/courses')
    return { ok: true }
  } catch (e) {
    // CWE-209: same as addSectionTeacher — specific auth message, otherwise collapse via toPortalActionError.
    if (e instanceof AuthError) return { ok: false, error: '无权管理该班级的教师' }
    return toPortalActionError(e, '移除教师失败')
  }
}
