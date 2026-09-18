import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { getPortalSchedule } from './data'
import ScheduleCards from './schedule-cards'

// "课表": upcoming lessons for ONLY the linked student(s) (row scope in getPortalSchedule →
// resolveLinkedStudentIds). Both parent and student roles hold lesson:['read']. Multi-child parents
// can filter by child via the client ScheduleCards wrapper (default 全部).
export default async function PortalPage() {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['read'] })
  const cards = await getPortalSchedule(ctx)

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <h2 className="text-lg font-semibold">课表</h2>
      {cards.length === 0 ? (
        <p className="text-sm text-neutral-500">暂无排课</p>
      ) : (
        <ScheduleCards cards={cards} />
      )}
    </section>
  )
}
