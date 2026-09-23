import 'server-only'
import { and, eq, gte, isNull, inArray, lt } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { forTenant } from '@/db/tenant'
import { shareLink, enrollment, lesson, classSection, course } from '@/db/schema'
import type { AuthContext } from '@/auth/context'
import type { FeedLesson } from '@/lib/ical-feed'
import { sliceLessonsForSections, withSectionTitles } from '@/lib/share'
import { sectionDisplayName } from '@/lib/ical-feed'
import { defaultShareExpiry, isTokenTimeActive } from '@/lib/share-ttl'

type Share = typeof shareLink.$inferSelect

// Active (non-revoked) share for ONE student, on the forTenant spine (M1). Mirrors
// calendar/actions.ts's findActiveFeed but scoped per-student (P4-1).
export async function getActiveShare(ctx: AuthContext, studentId: string): Promise<Share | null> {
  const rows = await forTenant(ctx).select(
    shareLink,
    and(eq(shareLink.studentId, studentId), isNull(shareLink.revokedAt)),
  )
  return rows[0] ?? null
}

// Idempotent: returns the student's active share, creating one (32-char nanoid capability) on
// first use. The partial-unique index (tenant_id, student_id WHERE revoked_at IS NULL) enforces
// one-active-per-student and guards the getOrCreate race (P4-1).
export async function ensureActiveShare(ctx: AuthContext, studentId: string): Promise<Share> {
  const existing = await getActiveShare(ctx, studentId)
  if (existing) {
    if (isTokenTimeActive(existing.expiresAt)) return existing
    // H6: active (not revoked) but time-expired → renew in place, SAME token, so the already-shared
    // /s/<token> URL keeps working. Avoids "panel shows a token but the public page 404s" (getActiveShare
    // filters only by revokedAt, but getShareByToken also filters expiry).
    const [renewed] = await forTenant(ctx).update(shareLink, existing.id, {
      expiresAt: defaultShareExpiry(),
    })
    return renewed
  }
  const [created] = await forTenant(ctx).insert(shareLink, {
    studentId,
    token: nanoid(32),
    label: '家长课表分享',
    expiresAt: defaultShareExpiry(),
  })
  return created
}

// Authenticated per-student slice: mirrors share.ts's public slice but on the forTenant spine
// (M1 forbids raw db on the authenticated path). Shares the SAME pure slicing helper so both
// paths filter identically (P4-4).
export async function getStudentLessonsForTenant(
  ctx: AuthContext,
  studentId: string,
  window: { from: Date; to: Date },
): Promise<FeedLesson[]> {
  const secs = await forTenant(ctx).select(
    enrollment,
    and(eq(enrollment.studentId, studentId), eq(enrollment.status, 'active')),
  )
  const ids = secs.map((s) => s.sectionId)
  // Empty active-enrollment set → `inArray([])` is invalid SQL; early-return.
  if (ids.length === 0) return []

  // PERF: push the window into SQL instead of loading a section's ENTIRE lesson history into memory and
  // slicing it there — this is called per-child (portal/data.ts fans out over every enrolled child), so
  // the unbounded load compounds. Bounds match sliceLessonsForSections's own `startAt >= from && < to`
  // (src/lib/share.ts), which still re-applies the window, so results are byte-identical — just cheaper.
  const rows = await forTenant(ctx).select(
    lesson,
    and(
      inArray(lesson.sectionId, ids),
      gte(lesson.startAt, window.from),
      lt(lesson.startAt, window.to),
    ),
  )

  // Resolve "课程名 · 班级名" for each section (two forTenant reads — the spine forbids raw joins) so
  // the authenticated preview/PNG card matches the public page instead of showing the generic "课节".
  const sections = await forTenant(ctx).select(classSection, inArray(classSection.id, ids))
  const courseIds = [...new Set(sections.map((s) => s.courseId))]
  const courses =
    courseIds.length === 0 ? [] : await forTenant(ctx).select(course, inArray(course.id, courseIds))
  const titleByCourse = new Map(courses.map((c) => [c.id, c.title]))
  const titleBySection = new Map<string, string>()
  for (const s of sections) {
    const courseTitle = titleByCourse.get(s.courseId)
    if (!courseTitle) continue
    titleBySection.set(s.id, sectionDisplayName(courseTitle, s.name))
  }

  return sliceLessonsForSections(withSectionTitles(rows, titleBySection), ids, window)
}
