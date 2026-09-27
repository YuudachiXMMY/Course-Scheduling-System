import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import { forTenant, type TenantExecutor } from '@/db/tenant'
import { classSection, enrollment, lesson, sectionTeacher, student } from '@/db/schema'
import { hasWholeTenantRole, isSectionScopedRole } from '@/auth/roles'
import type { AuthContext } from '@/auth/context'

// 工作流 E + 多教师 — 教师/助教本班收敛. Two-universe recap (permissions.ts): org roles run tenant business
// and the platform superadmin bypasses tenant RBAC. On TOP of tenant isolation (forTenant is the only
// sanctioned tenant-scoped path), a section-scoped actor (teacher OR assistant) is further confined to the
// sections they are LINKED to via section_teacher (an admin adds them in 班级设置) and, by extension, the
// students actively enrolled in those sections. Only owner/admin and the platform superadmin manage the
// whole tenant; an assistant/teacher who has NOT been added to any section sees nothing.
//
// The scope helpers return 'all' (no section/student restriction) OR the explicit id list. An EMPTY list
// means "this actor sees nothing" — callers MUST short-circuit before inArray([]) (invalid SQL; the
// existing code already guards this, see schedule/data.ts and teach/[sectionId]/data.ts).

// Whole-tenant actor: the cross-tenant operator, or any member holding owner/admin/assistant.
export function isWholeTenantActor(ctx: AuthContext): boolean {
  return ctx.isPlatformAdmin || hasWholeTenantRole(ctx.role)
}

// 多教师归属: whether `userId` is LINKED to `sectionId` in section_teacher — a section-scoped
// teacher/assistant's access set. Pure membership (the whole-tenant short-circuit lives in the callers
// below). Runs on the forTenant spine so M1 tenant isolation still holds. H7: an optional `exec` lets a
// caller inside db.transaction(tx => …) thread its `tx` so this read joins that ONE transaction (no second
// pool borrow → no pool-exhaustion; default undefined → forTenant falls back to the module `db`).
export async function isSectionMember(
  ctx: AuthContext,
  sectionId: string,
  exec?: TenantExecutor,
): Promise<boolean> {
  const rows = await forTenant(ctx, exec).select(
    sectionTeacher,
    and(eq(sectionTeacher.sectionId, sectionId), eq(sectionTeacher.userId, ctx.userId)),
  )
  return rows.length > 0
}

// Whether the actor may open a specific section's workspace. Whole-tenant staff → always; a section-scoped
// teacher/assistant → the section's PRIMARY teacher (classSection.teacherId) OR anyone LINKED to it via
// section_teacher (multi-teacher). The primary is always considered a member (createSection seeds a link
// for them; this OR is also a belt-and-suspenders against link/primary drift). Takes an already-loaded
// section row (id + teacherId) — pass the CURRENT classSection row, never a lesson's frozen teacherId (see
// actorOwnsLesson). getSectionHeader() calls it, gating the whole /dashboard/teach/[sectionId] route via
// its layout so a section-scoped actor who guesses a foreign section id gets notFound(). `exec` is threaded
// to the membership read for in-transaction callers (H7).
export async function actorOwnsSection(
  ctx: AuthContext,
  section: { id: string; teacherId: string | null },
  exec?: TenantExecutor,
): Promise<boolean> {
  return (
    isWholeTenantActor(ctx) ||
    section.teacherId === ctx.userId ||
    (await isSectionMember(ctx, section.id, exec))
  )
}

// The section ids this actor may see: 'all' for whole-tenant staff, else exactly the teacher's own
// sections. A section-scoped actor with no sections (or a portal/unknown role reaching here) → [].
export async function sectionIdsForActor(ctx: AuthContext): Promise<'all' | string[]> {
  if (isWholeTenantActor(ctx)) return 'all'
  if (!isSectionScopedRole(ctx.role)) return [] // defensive: portal/unknown role → see nothing
  // 多教师: the sections this actor is LINKED to (section_teacher) UNION the sections where they are the
  // PRIMARY teacher (classSection.teacherId). The primary is always a member conceptually; this UNION keeps
  // access correct even if a link row were ever missing. Deduped.
  const [links, primary] = await Promise.all([
    forTenant(ctx).select(sectionTeacher, eq(sectionTeacher.userId, ctx.userId)),
    forTenant(ctx).select(classSection, eq(classSection.teacherId, ctx.userId)),
  ])
  return [...new Set([...links.map((r) => r.sectionId), ...primary.map((r) => r.id)])]
}

// The student ids this actor may see: 'all', else the students ACTIVELY enrolled in the actor's sections
// UNION the students this actor CREATED (AZ3). Derived from sectionIdsForActor so section- and
// student-scope share one source of truth.
export async function studentIdsForActor(ctx: AuthContext): Promise<'all' | string[]> {
  const sections = await sectionIdsForActor(ctx)
  if (sections === 'all') return 'all'
  // AZ3: a section-scoped teacher ALSO sees students they created themselves — student:create inserts a
  // student with NO enrollment, so the enrollment-only set would make a brand-new student permanently
  // invisible to its creator. The predicate is STRICTLY createdBy === ctx.userId (never OR-ing away the
  // enrollment filter), so a teacher still can't see students they neither created nor teach.
  const created = await forTenant(ctx).select(student, eq(student.createdBy, ctx.userId))
  const createdIds = created.map((s) => s.id)
  if (sections.length === 0) return [...new Set(createdIds)]
  const enrolls = await forTenant(ctx).select(
    enrollment,
    and(inArray(enrollment.sectionId, sections), eq(enrollment.status, 'active')),
  )
  return [...new Set([...enrolls.map((e) => e.studentId), ...createdIds])]
}

// Whether the actor may act on ONE specific student: whole-tenant staff → always; a teacher → only a
// student ACTIVELY enrolled in a section they teach. Derived from studentIdsForActor so it shares the
// same source of truth as the collection scope. Used by the per-student API export routes and the
// per-student write paths (share token minting, student edits) that bypass the RSC layout guard and so
// must enforce ownership themselves — mirrors actorOwnsSection for the single-section case.
export async function actorOwnsStudent(ctx: AuthContext, studentId: string): Promise<boolean> {
  const students = await studentIdsForActor(ctx)
  return students === 'all' || students.includes(studentId)
}

// id-keyed ownership for the WRITE paths that only receive a sectionId (cancelSeriesAction,
// updateSection, materializeSectionAction). Whole-tenant staff bypass without a query; a section-scoped
// teacher loads the section and checks teacherId. A missing/foreign section → false (caller throws or
// 404s), so a guessed same-tenant sectionId can never mutate another teacher's class.
export async function actorOwnsSectionById(
  ctx: AuthContext,
  sectionId: string,
  exec?: TenantExecutor,
): Promise<boolean> {
  if (isWholeTenantActor(ctx)) return true
  const section = await forTenant(ctx, exec).findById(classSection, sectionId)
  return (
    !!section &&
    (section.teacherId === ctx.userId || (await isSectionMember(ctx, sectionId, exec)))
  )
}

// id-keyed ownership for the WRITE paths that only receive a lessonId (cancelLessonAction,
// updateLessonAction, attendance/note/grade upserts). 多教师 SECURITY: authorize on the lesson's CURRENT
// section (section.teacherId + section_teacher membership via actorOwnsSection) — NEVER the frozen
// lesson.teacherId. lesson.teacherId is denormalized once at materialize time and never updated, so a
// teacher REMOVED from the section (their section_teacher link deleted, classSection.teacherId repointed)
// would otherwise keep write access to every already-materialized lesson whose stale teacherId still equals
// their id. Resolving the current section closes that hole. A missing/foreign lesson or section → false.
export async function actorOwnsLesson(
  ctx: AuthContext,
  lessonId: string,
  exec?: TenantExecutor,
): Promise<boolean> {
  if (isWholeTenantActor(ctx)) return true
  const row = await forTenant(ctx, exec).findById(lesson, lessonId)
  if (!row) return false
  const section = await forTenant(ctx, exec).findById(classSection, row.sectionId)
  return !!section && (await actorOwnsSection(ctx, section, exec))
}

// F2 / B31: object-level authz for the lesson-scoped student WRITE paths (grade / attendance / per-student
// note). Owning the LESSON (actorOwnsLesson) is not enough — each of those rows' FK is (tenant, student),
// which only guarantees same-tenant, NOT same-roster. Without this a teacher could write a grade / ghost
// attendance / comment for ANY same-tenant student, permanently polluting a foreign student's record.
// True iff `studentId` is ACTIVELY enrolled in the section that owns `lessonId`. A missing lesson → false.
export async function studentActiveInLessonSection(
  ctx: AuthContext,
  lessonId: string,
  studentId: string,
): Promise<boolean> {
  const lrow = await forTenant(ctx).findById(lesson, lessonId)
  if (!lrow) return false
  const enrolled = await forTenant(ctx).select(
    enrollment,
    and(
      eq(enrollment.sectionId, lrow.sectionId),
      eq(enrollment.studentId, studentId),
      eq(enrollment.status, 'active'),
    ),
  )
  return enrolled.length > 0
}
