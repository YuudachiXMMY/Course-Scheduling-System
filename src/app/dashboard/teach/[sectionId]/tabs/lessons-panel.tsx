import { requireAuthContext } from '@/auth/context'
import { can } from '@/auth/authorize'
import { getSectionLessons } from '../data'
import SectionLessons from '../section-lessons'

export default async function LessonsPanel({ sectionId }: { sectionId: string }) {
  const ctx = await requireAuthContext()
  const lessons = await getSectionLessons(ctx, sectionId)
  return (
    <SectionLessons
      sectionId={sectionId}
      lessons={lessons}
      canManage={can(ctx.role, { lesson: ['update'] })}
    />
  )
}
