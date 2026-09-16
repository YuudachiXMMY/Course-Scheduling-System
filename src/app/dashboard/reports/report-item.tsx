'use client'

import { useState } from 'react'
import { updateReportNarrative, approveReport, type ReportResult } from './actions'
import type { ReportRow } from './data'
import InlineConfirm from '../_components/inline-confirm'

// Extracted from report-panel.tsx so both the standalone /dashboard/reports page and the workspace
// 报告 tab render the same report card. Behaviour matches the original, with two deliberate changes:
// the approve gate is an in-DOM InlineConfirm instead of window.confirm (no non-fixme e2e drives
// approve), and an optional `readOnly` renders the narrative locked (assistant view: report:list but
// not report:update/approve).
export function ReportItem({
  report,
  studentName,
  onRun,
  pending,
  readOnly = false,
}: {
  report: ReportRow
  studentName: string
  onRun: (fn: () => Promise<ReportResult>) => void
  pending: boolean
  readOnly?: boolean
}) {
  const [text, setText] = useState(report.narrative ?? '')
  const approved = report.status === 'approved'
  const locked = approved || readOnly
  const period =
    report.periodStart && report.periodEnd ? `${report.periodStart} ~ ${report.periodEnd}` : '—'

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-neutral-200 px-4 py-3 tabular-nums shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-sm font-medium">{report.title || `${studentName} 进度报告`}</span>
          <span className="text-xs text-neutral-500">
            {studentName} · {period}
          </span>
        </div>
        <span
          className={`rounded px-2 py-0.5 text-xs ${
            approved ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
          }`}
        >
          {approved ? '已定稿' : '草稿'}
        </span>
      </div>

      {locked ? (
        <p className="text-sm whitespace-pre-wrap text-neutral-800">{report.narrative}</p>
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
        />
      )}

      <div className="flex flex-wrap gap-2">
        {!locked && (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => onRun(() => updateReportNarrative({ id: report.id, narrative: text }))}
              className="rounded border border-neutral-300 px-3 py-1 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              保存
            </button>
            <InlineConfirm
              danger
              label="批准"
              confirmLabel="确认定稿"
              disabled={pending}
              onConfirm={() => onRun(() => approveReport(report.id))}
            />
          </>
        )}
        <a
          href={`/api/reports/${report.id}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded border border-neutral-300 px-3 py-1 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          下载 PDF
        </a>
      </div>
    </li>
  )
}
