import 'server-only'
import type { AuthContext } from '@/auth/context'
import { forTenant } from '@/db/tenant'
import { student } from '@/db/schema'
import { getStudentLessonsForTenant } from '@/app/dashboard/students/share-data'
import { cardWindow, type FeedLesson } from '@/lib/ical-feed'
import { resolveLinkedStudentIds, requireConsent } from '@/auth/portal'

// Phase 7a — the portal's "我的课表": upcoming lessons for ONLY the students this user is linked to.
// Reuses the Phase-4 authenticated per-student pipeline (getStudentLessonsForTenant, forTenant spine
// + ScheduleCard shape) — NOT the public /s/[token] path. Data-loader convention: takes ctx, does not
// self-gate (the calling page owns requireAuthContext + requirePermission).
export interface PortalCard {
  studentId: string
  studentName: string
  subtitle?: string
  lessons: FeedLesson[]
}

export async function getPortalSchedule(ctx: AuthContext): Promise<PortalCard[]> {
  await requireConsent(ctx) // 服务端同意门复检：读孩子课表前必须已同意
  const ids = await resolveLinkedStudentIds(ctx)
  // PERF9: resolve each linked student's card in parallel (was a sequential per-child loop, each child
  // ~4+ serial queries via getStudentLessonsForTenant). Promise.all preserves input order, and the
  // missing-student null-filter reproduces the old `if (!s) continue` semantics exactly.
  const cards = (
    await Promise.all(
      ids.map(async (id): Promise<PortalCard | null> => {
        const s = await forTenant(ctx).findById(student, id)
        if (!s) return null
        return {
          studentId: id,
          studentName: s.name,
          subtitle: s.schoolGrade ?? undefined,
          lessons: await getStudentLessonsForTenant(ctx, id, cardWindow()),
        }
      }),
    )
  ).filter((c): c is PortalCard => c !== null)
  return cards
}
