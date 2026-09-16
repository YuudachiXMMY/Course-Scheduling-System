import { requireAuthContext } from '@/auth/context'
import { can } from '@/auth/authorize'
import { listStudents } from '@/app/dashboard/students/actions'
import SectionRoster from '@/app/dashboard/courses/section-roster'
import { getSectionHeader, getSectionRoster } from '../data'

// 学生 tab: the existing SectionRoster, embedded (always-open) and SC-seeded so there's no client
// useEffect fetch. Assistant (course:read only) gets a read-only roster.
export default async function StudentsPanel({ sectionId }: { sectionId: string }) {
  const ctx = await requireAuthContext()
  const [{ section }, roster, allStudents] = await Promise.all([
    getSectionHeader(ctx, sectionId),
    getSectionRoster(ctx, sectionId),
    listStudents(),
  ])
  const studentOptions = allStudents
    .filter((s) => s.status !== 'archived')
    .map((s) => ({ id: s.id, name: s.name }))

  return (
    <SectionRoster
      sectionId={sectionId}
      capacity={section.capacity}
      students={studentOptions}
      embedded
      readOnly={!can(ctx.role, { course: ['update'] })}
      initialEnrolledIds={roster.map((r) => r.id)}
    />
  )
}
