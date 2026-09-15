import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { ScheduleCard } from '@/lib/schedule-card'
import { getPortalSchedule } from './data'

// "我的课表": upcoming lessons for ONLY the linked student(s) (row scope in getPortalSchedule →
// resolveLinkedStudentIds). Both parent and student roles hold lesson:['read'].
export default async function PortalPage() {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['read'] })
  const cards = await getPortalSchedule(ctx)

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <h2 className="text-lg font-semibold">我的课表</h2>
      {cards.length === 0 && <p className="text-sm text-neutral-500">暂无排课</p>}
      {cards.map((c) => (
        <ScheduleCard
          key={c.studentId}
          data={{ studentName: c.studentName, subtitle: c.subtitle, lessons: c.lessons }}
        />
      ))}
    </section>
  )
}
