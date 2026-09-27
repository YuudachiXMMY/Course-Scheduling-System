import { requireAuthContext } from '@/auth/context'
import { can } from '@/auth/authorize'
import {
  getSectionLessons,
  getSectionRoster,
  getSectionLessonNotes,
  getSectionScheduleSummary,
} from '../data'
import SectionLessons from '../section-lessons'
import ScheduleSummaryCard from '../schedule-summary-card'

export default async function LessonsPanel({ sectionId }: { sectionId: string }) {
  const ctx = await requireAuthContext()
  const [lessons, roster, summary] = await Promise.all([
    getSectionLessons(ctx, sectionId),
    getSectionRoster(ctx, sectionId),
    getSectionScheduleSummary(ctx, sectionId),
  ])
  // Depends on the lessons' ids → awaited after the Promise.all that produces them.
  const notes = await getSectionLessonNotes(
    ctx,
    lessons.map((l) => l.id),
  )
  return (
    <>
      <ScheduleSummaryCard summary={summary} />
      <SectionLessons
        sectionId={sectionId}
        lessons={lessons}
        roster={roster}
        notes={notes}
        canManage={can(ctx.role, { lesson: ['update'] })}
      />
    </>
  )
}
