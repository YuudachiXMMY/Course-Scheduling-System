import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { listSections } from '../courses/actions'
import { listLessonsInRange } from './data'
import ScheduleCalendar from './calendar'

export default async function SchedulePage() {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['list'] })
  // 工作流 E: both the calendar events and the section picker are confined to what this actor may see
  // (teacher → only their own sections/lessons) — listSections() already applies sectionIdsForActor.
  const events = await listLessonsInRange(ctx)
  const sections = await listSections()
  const sectionOptions = sections.map((s) => ({ id: s.id, name: s.name ?? '（未命名班级）' }))

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">排课</h2>
      <ScheduleCalendar initialEvents={events} sections={sectionOptions} />
    </section>
  )
}
