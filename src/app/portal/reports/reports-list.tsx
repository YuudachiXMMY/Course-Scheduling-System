'use client'

import { useMemo, useState } from 'react'
import { WHOLE_SCHEDULE_KEY } from './constants'
import {
  filterReports,
  groupReportsByMonth,
  monthOptions,
  countByKey,
} from './filter'
import type {
  PortalReportRow,
  PortalStudentOption,
  PortalSectionOption,
} from './data'

// Portal report list with three client-side filters (child studentId、course/section、月份). Data is
// already row-scoped + approved-only on the server; this component only narrows and regroups the view.
// 每个筛选项带数量徽标（该桶命中报告数，基于全量 row-scoped 数据），结果按月份倒序分组展示。
export default function ReportsList({
  reports,
  students,
  sections,
}: {
  reports: PortalReportRow[]
  students: PortalStudentOption[]
  sections: PortalSectionOption[]
}) {
  const [studentId, setStudentId] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [month, setMonth] = useState('')

  // 数量徽标与月份选项由全量 row-scoped 报告派生（非当前筛选结果），让用户切换筛选前即可看到各桶规模。
  const studentCount = useMemo(() => countByKey(reports, (r) => r.studentId), [reports])
  const sectionCount = useMemo(
    () => countByKey(reports, (r) => r.sectionId ?? WHOLE_SCHEDULE_KEY),
    [reports],
  )
  const months = useMemo(() => monthOptions(reports), [reports])

  const groups = useMemo(
    () => groupReportsByMonth(filterReports(reports, { studentId, sectionId, month })),
    [reports, studentId, sectionId, month],
  )
  const total = groups.reduce((n, g) => n + g.reports.length, 0)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-3">
        {/* 仅一个孩子的家长/学生本人无需按学生筛选，但保留控件以保持无障碍与一致性。 */}
        <select
          aria-label="按学生筛选"
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
        >
          <option value="">全部学生</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({studentCount.get(s.id) ?? 0})
            </option>
          ))}
        </select>
        <select
          aria-label="按课程班级筛选"
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
          className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
        >
          <option value="">全部课程</option>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} ({sectionCount.get(s.id) ?? 0})
            </option>
          ))}
        </select>
        <select
          aria-label="按月份筛选"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
        >
          <option value="">全部月份</option>
          {months.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} ({m.count})
            </option>
          ))}
        </select>
      </div>

      {total === 0 ? (
        <p className="rounded-lg border border-neutral-200 px-4 py-8 text-center text-sm text-neutral-500">
          暂无符合筛选条件的报告
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((g) => (
            <section key={g.month} className="flex flex-col gap-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-400 tabular-nums">
                {g.month}
              </h3>
              <ul className="flex flex-col gap-3">
                {g.reports.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-4 shadow-sm"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h4 className="text-sm font-medium text-neutral-900">
                        {r.title || '进度报告'}
                      </h4>
                      <span className="text-xs text-neutral-500 tabular-nums">
                        {r.periodStart && r.periodEnd
                          ? `${r.periodStart} ~ ${r.periodEnd}`
                          : r.createdAt}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs text-neutral-500">
                      <span>{r.studentName}</span>
                      <span aria-hidden>·</span>
                      <span>{r.sectionLabel}</span>
                    </div>
                    {r.narrative && (
                      <p className="whitespace-pre-wrap text-sm text-neutral-700">{r.narrative}</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
