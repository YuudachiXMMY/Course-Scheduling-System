import type { LessonStats, ScheduleSummary } from '@/lib/schedule-summary'

// Presentational summary for the 排课 tab. Pure display — all numbers are pre-computed server-side in
// getSectionScheduleSummary (no Date.now() here), so this stays a server component with no client state.

function LessonTile({ label, stats }: { label: string; stats: LessonStats }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-sm text-neutral-900">
        <span className="text-lg font-semibold">{stats.count}</span>
        <span className="ml-0.5 text-neutral-500">节</span>
        <span className="mx-1.5 text-neutral-300">·</span>
        <span className="text-lg font-semibold">{stats.hours}</span>
        <span className="ml-0.5 text-neutral-500">小时</span>
      </div>
    </div>
  )
}

function SpanTile({ label, weeks, months }: { label: string; weeks: number; months: number }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-sm text-neutral-900">
        <span className="text-lg font-semibold">{weeks}</span>
        <span className="ml-0.5 text-neutral-500">周</span>
        <span className="mx-1.5 text-neutral-300">·</span>
        <span className="text-lg font-semibold">{months}</span>
        <span className="ml-0.5 text-neutral-500">个月</span>
      </div>
    </div>
  )
}

export default function ScheduleSummaryCard({ summary }: { summary: ScheduleSummary }) {
  const { totalScheduled, totalTaught, monthScheduled, monthTaught, semester } = summary
  return (
    <section
      aria-label="排课汇总"
      className="mb-4 rounded-xl border border-neutral-200 bg-neutral-50 p-3"
    >
      <h2 className="mb-2 text-sm font-medium text-neutral-700">排课汇总</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <LessonTile label="总共安排" stats={totalScheduled} />
        <LessonTile label="总共已上" stats={totalTaught} />
        <LessonTile label="本月安排" stats={monthScheduled} />
        <LessonTile label="本月已上" stats={monthTaught} />
        {semester ? (
          <>
            <SpanTile label="学期跨度" weeks={semester.totalWeeks} months={semester.totalMonths} />
            <SpanTile
              label="距学期结束"
              weeks={semester.remainingWeeks}
              months={semester.remainingMonths}
            />
          </>
        ) : (
          <div className="col-span-2 flex items-center rounded-lg border border-dashed border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-400 sm:col-span-1 lg:col-span-2">
            未设置学期起止日期
          </div>
        )}
      </div>
    </section>
  )
}
