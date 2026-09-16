import { DateTime } from 'luxon'
import { requireAuthContext } from '@/auth/context'
import { can } from '@/auth/authorize'
import { getSectionRoster, getSectionReports } from '../data'
import SectionReportPanel from '../section-report-panel'
import { APP_TIME_ZONE } from '@/lib/timezone'

const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined)

// 报告 tab: the section roster is the student picker; the current natural month is computed HERE
// (server, America/Toronto) so the default range doesn't drift on client hydration. The cross-section
// aggregation semantic is disclosed in-UI so a section-framed report isn't misread as section-scoped.
export default async function ReportsPanel({
  sectionId,
  searchParams,
}: {
  sectionId: string
  searchParams: Record<string, string | string[] | undefined>
}) {
  const ctx = await requireAuthContext()
  const [roster, reports] = await Promise.all([
    getSectionRoster(ctx, sectionId),
    getSectionReports(ctx, sectionId),
  ])
  const now = DateTime.now().setZone(APP_TIME_ZONE)
  const defaultFrom = now.startOf('month').toFormat('yyyy-MM-dd')
  const defaultTo = now.endOf('month').toFormat('yyyy-MM-dd')

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-neutral-400">
        报告汇总该学生在所选时间段内的全部课程记录（含其他班级），本班仅作为选择入口。
      </p>
      <SectionReportPanel
        sectionId={sectionId}
        roster={roster}
        reports={reports}
        defaultFrom={defaultFrom}
        defaultTo={defaultTo}
        canWrite={can(ctx.role, { report: ['create'] })}
        initialStudent={str(searchParams.student)}
        initialPeriod={str(searchParams.period)}
        initialFrom={str(searchParams.from)}
        initialTo={str(searchParams.to)}
      />
    </div>
  )
}
