import { requireAuthContext } from '@/auth/context'
import { can } from '@/auth/authorize'
import { getSectionLessons, getSectionRoster, getSectionLessonNotes } from '../data'
import SectionLessons from '../section-lessons'

export default async function LessonsPanel({ sectionId }: { sectionId: string }) {
  const ctx = await requireAuthContext()
  const [lessons, roster] = await Promise.all([
    getSectionLessons(ctx, sectionId),
    getSectionRoster(ctx, sectionId),
  ])
  // Depends on the lessons' ids → awaited after the Promise.all that produces them.
  const notes = await getSectionLessonNotes(
    ctx,
    lessons.map((l) => l.id),
  )
  return (
    <SectionLessons
      sectionId={sectionId}
      lessons={lessons}
      roster={roster}
      notes={notes}
      canManage={can(ctx.role, { lesson: ['update'] })}
    />
  )
}
