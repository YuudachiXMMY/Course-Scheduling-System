import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { forTenant } from '@/db/tenant'
import { classSection } from '@/db/schema'
import { listLessonsInRange } from './data'
import ScheduleCalendar from './calendar'

export default async function SchedulePage() {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['list'] })
  const events = await listLessonsInRange(ctx)
  const sections = (await forTenant(ctx).select(
    classSection,
  )) as (typeof classSection.$inferSelect)[]
  const sectionOptions = sections.map((s) => ({ id: s.id, name: s.name ?? '（未命名班级）' }))

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">排课</h2>
      <ScheduleCalendar initialEvents={events} sections={sectionOptions} />
    </section>
  )
}
