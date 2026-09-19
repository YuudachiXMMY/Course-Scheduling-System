'use client'

import { useState } from 'react'
import { WHOLE_SCHEDULE_KEY } from './constants'
import type {
  PortalReportRow,
  PortalStudentOption,
  PortalSectionOption,
} from './data'

// Portal report list with two client-side filters (by child studentId, by course/section). Data is
// already row-scoped + approved-only on the server; this component only narrows the view.
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

  const filtered = reports.filter(
    (r) =>
      (!studentId || r.studentId === studentId) &&
      (!sectionId || (r.sectionId ?? WHOLE_SCHEDULE_KEY) === sectionId),
  )

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
              {s.name}
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
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <ul className="flex flex-col gap-3">
        {filtered.length === 0 && (
          <li className="rounded-lg border border-neutral-200 px-4 py-8 text-center text-sm text-neutral-500">
            暂无报告
          </li>
        )}
        {filtered.map((r) => (
          <li
            key={r.id}
            className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium text-neutral-900">
                {r.title || '进度报告'}
              </h3>
              <span className="text-xs text-neutral-500">
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
    </div>
  )
}
