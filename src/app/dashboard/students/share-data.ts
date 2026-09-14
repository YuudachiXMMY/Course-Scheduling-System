import 'server-only'
import { and, eq, isNull, inArray } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { forTenant } from '@/db/tenant'
import { shareLink, enrollment, lesson } from '@/db/schema'
import type { AuthContext } from '@/auth/context'
import type { FeedLesson } from '@/lib/ical-feed'
import { sliceLessonsForSections } from '@/lib/share'

type Share = typeof shareLink.$inferSelect

// Active (non-revoked) share for ONE student, on the forTenant spine (M1). Mirrors
// calendar/actions.ts's findActiveFeed but scoped per-student (P4-1).
export async function getActiveShare(ctx: AuthContext, studentId: string): Promise<Share | null> {
  const rows = (await forTenant(ctx).select(
    shareLink,
    and(eq(shareLink.studentId, studentId), isNull(shareLink.revokedAt)),
  )) as Share[]
  return rows[0] ?? null
}

// Idempotent: returns the student's active share, creating one (32-char nanoid capability) on
// first use. The partial-unique index (tenant_id, student_id WHERE revoked_at IS NULL) enforces
// one-active-per-student and guards the getOrCreate race (P4-1).
export async function ensureActiveShare(ctx: AuthContext, studentId: string): Promise<Share> {
  const existing = await getActiveShare(ctx, studentId)
  if (existing) return existing
  const [created] = (await forTenant(ctx).insert(shareLink, {
    studentId,
    token: nanoid(32),
    label: '家长课表分享',
  })) as Share[]
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
  const secs = (await forTenant(ctx).select(
    enrollment,
    and(eq(enrollment.studentId, studentId), eq(enrollment.status, 'active')),
  )) as (typeof enrollment.$inferSelect)[]
  const ids = secs.map((s) => s.sectionId)
  // Empty active-enrollment set → `inArray([])` is invalid SQL; early-return.
  if (ids.length === 0) return []

  const rows = (await forTenant(ctx).select(
    lesson,
    inArray(lesson.sectionId, ids),
  )) as (typeof lesson.$inferSelect)[]

  return sliceLessonsForSections(rows, ids, window)
}
