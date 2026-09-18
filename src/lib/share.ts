import 'server-only'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { shareLink, enrollment, lesson, classSection, course } from '@/db/schema'
import { type FeedLesson, feedWindow, sectionDisplayName } from '@/lib/ical-feed'

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
    // Order by start time ascending so the shared schedule card renders lessons by date —
    // the DB query has no ORDER BY, so row order is otherwise undefined. Single sort point
    // covers both the public share page and the authenticated preview path.
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
}

// A lesson row only stores a title when it was manually renamed off-pattern; auto-materialized
// lessons leave it null, so the schedule card / iCal fell back to the generic "课节". Resolve a
// human display name from the lesson's SECTION → COURSE ("课程名 · 班级名") and fill it in where the
// lesson has no explicit title. PURE — testable with a fabricated section-name map (single logic
// path shared by both public + authenticated slice callers).
export function withSectionTitles<T extends SliceableLesson>(
  rows: T[],
  titleBySection: Map<string, string>,
): T[] {
  return rows.map((r) => ({ ...r, title: r.title ?? titleBySection.get(r.sectionId) ?? null }))
}

// Build the sectionId → "课程名 · 班级名" map for a set of sections, on the PUBLIC (token-scoped) db
// path. Scope by the token-resolved tenantId only — never a request param (mirrors the reads below).
async function courseTitlesForSections(
  tenantId: string,
  sectionIds: string[],
): Promise<Map<string, string>> {
  if (sectionIds.length === 0) return new Map()
  const rows = await db
    .select({ id: classSection.id, name: classSection.name, courseTitle: course.title })
    .from(classSection)
    .innerJoin(
      course,
      and(eq(course.tenantId, classSection.tenantId), eq(course.id, classSection.courseId)),
    )
    .where(and(eq(classSection.tenantId, tenantId), inArray(classSection.id, sectionIds)))
  return new Map(rows.map((r) => [r.id, sectionDisplayName(r.courseTitle, r.name)]))
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

  // Fill each lesson's display title from its course/section before slicing, so the public card
  // shows "课程名 · 班级名" instead of the generic "课节" fallback.
  const titleBySection = await courseTitlesForSections(tenantId, sectionIds)
  const named = withSectionTitles(rows, titleBySection)

  // Window + non-canceled + section membership all live in the pure helper (single logic path).
  return sliceLessonsForSections(named, sectionIds, window)
}
