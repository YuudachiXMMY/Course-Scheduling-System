import 'server-only'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { shareLink, enrollment, lesson } from '@/db/schema'
import { type FeedLesson, feedWindow } from '@/lib/ical-feed'

// Shape the pure slicing helper needs from a lesson row. Kept minimal so BOTH the public
// reader below AND the authenticated share-data path (src/app/dashboard/students/share-data.ts)
// can feed it whatever they SELECT — a full `lesson.$inferSelect` row is structurally assignable.
export interface SliceableLesson {
  id: string
  title: string | null
  startAt: Date
  endAt: Date
  location: string | null
  sectionId: string
  status: string
}

// PURE — no DB, no Playwright. The single source of truth for per-student slicing (P4-4):
// keep only lessons whose section is one of the student's ACTIVE sections, that are NOT
// canceled, and that fall inside the rolling window. Exported so it is unit-testable with
// fabricated rows (tests/share-slicing.test.ts) and shared by both slice paths (public
// share.ts + authenticated share-data.ts) so the "each parent sees only their child" rule
// has ONE implementation.
export function sliceLessonsForSections(
  rows: SliceableLesson[],
  activeSectionIds: string[],
  window: { from: Date; to: Date },
): FeedLesson[] {
  const active = new Set(activeSectionIds)
  return rows
    .filter(
      (r) =>
        active.has(r.sectionId) &&
        r.status !== 'canceled' &&
        r.startAt >= window.from &&
        r.startAt < window.to,
    )
    .map((r) => ({
      id: r.id,
      title: r.title,
      startAt: r.startAt,
      endAt: r.endAt,
      location: r.location,
    }))
}

// Resolve a capability token to its (non-revoked) shareLink row, or null. Global-unique token
// index → a single row; a revoked token resolves to null so its URL 404s.
export async function getShareByToken(token: string) {
  const [row] = await db
    .select()
    .from(shareLink)
    .where(and(eq(shareLink.token, token), isNull(shareLink.revokedAt)))
    .limit(1)
  return row ?? null
}

// P4-2 EXCEPTION: NO AuthContext here. `tenantId`/`studentId` come from a token-resolved
// `shareLink` row (a verified capability, via getShareByToken) — NEVER from a request param.
// Scope STRICTLY by them; do NOT use forTenant() (it requires a principal). This is the SECOND
// (and last) sanctioned public read path — confined to this file, mirroring src/lib/ical-feed.ts.
export async function getStudentScheduleForShare(
  tenantId: string,
  studentId: string,
  window = feedWindow(),
): Promise<FeedLesson[]> {
  // The student's ACTIVE sections (a parent must see only their child's current lessons).
  const secs = await db
    .select({ sectionId: enrollment.sectionId })
    .from(enrollment)
    .where(
      and(
        eq(enrollment.tenantId, tenantId),
        eq(enrollment.studentId, studentId),
        eq(enrollment.status, 'active'),
      ),
    )
  const sectionIds = secs.map((s) => s.sectionId)
  // Empty active-enrollment set → `inArray([])` is invalid SQL; early-return so we never emit it.
  if (sectionIds.length === 0) return []

  const rows = await db
    .select({
      id: lesson.id,
      title: lesson.title,
      startAt: lesson.startAt,
      endAt: lesson.endAt,
      location: lesson.location,
      sectionId: lesson.sectionId,
      status: lesson.status,
    })
    .from(lesson)
    .where(and(eq(lesson.tenantId, tenantId), inArray(lesson.sectionId, sectionIds)))

  // Window + non-canceled + section membership all live in the pure helper (single logic path).
  return sliceLessonsForSections(rows, sectionIds, window)
}
