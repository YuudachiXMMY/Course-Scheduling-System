import type { ReactNode } from 'react'
import Link from 'next/link'
import { requireAuthContext } from '@/auth/context'
import { can } from '@/auth/authorize'
import { getSectionHeader, getSectionPendingRescheduleCount } from './data'
import TabBar from './tab-bar'

// Per-section header + tab bar. getSectionHeader() → notFound() for a stale/cross-tenant id; a real
// failure here bubbles to teach/error.tsx (rail preserved). This layout mounts per [sectionId], so a
// section switch shows [sectionId]/loading.tsx over the main pane while the header/tabs re-fetch.
export default async function SectionLayout({
  params,
  children,
}: {
  params: Promise<{ sectionId: string }>
  children: ReactNode
}) {
  const { sectionId } = await params
  const ctx = await requireAuthContext()
  const { section, course } = await getSectionHeader(ctx, sectionId)
  const canManage = can(ctx.role, { course: ['update'] })
  // Contextual signal only; the queue lives at /dashboard/reschedule. Reviewers (approve perm) see it
  // as an actionable link, read-only roles as plain text.
  const pendingReschedules = await getSectionPendingRescheduleCount(ctx, sectionId)
  const canReview = can(ctx.role, { rescheduleRequest: ['approve'] })

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-semibold">{course.title}</h2>
          <p className="text-sm text-neutral-500 tabular-nums">
            {section.name ?? '（未命名班级）'} · 容量 {section.capacity} 人
          </p>
        </div>
        {pendingReschedules > 0 &&
          (canReview ? (
            <Link
              href="/dashboard/reschedule"
              className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs text-amber-800 tabular-nums hover:bg-amber-100"
            >
              {pendingReschedules} 条待处理改期 →
            </Link>
          ) : (
            <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-700 tabular-nums">
              {pendingReschedules} 条待处理改期
            </span>
          ))}
      </header>
      <TabBar sectionId={sectionId} canManage={canManage} />
      {children}
    </section>
  )
}
