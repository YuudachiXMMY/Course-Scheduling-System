'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createReportDraft, updateReportNarrative, approveReport } from './actions'
import type { ReportRow, StudentOption } from './data'

export default function ReportPanel({
  students,
  reports,
}: {
  students: StudentOption[]
  reports: ReportRow[]
}) {
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const router = useRouter()
  const nameOf = new Map(students.map((s) => [s.id, s.name]))

  // generate-form state
  const [studentId, setStudentId] = useState(students[0]?.id ?? '')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [title, setTitle] = useState('')

  function run(fn: () => Promise<unknown>) {
    setErr(null)
    startTransition(async () => {
      try {
        await fn()
        router.refresh()
      } catch (e) {
        setErr(e instanceof Error ? e.message : '操作失败')
      }
    })
  }

  function generate(e: React.FormEvent) {
    e.preventDefault()
    if (!studentId || !periodStart || !periodEnd) {
      setErr('请选择学生与时间段')
      return
    }
    setErr(null)
    startTransition(async () => {
      // createReportDraft returns problems as data (see actions.ts) so a missing API key / drafting
      // failure shows a helpful message instead of the redacted "React error #441" crash.
      const res = await createReportDraft({
        studentId,
        periodStart,
        periodEnd,
        title: title.trim() || undefined,
      })
      if (!res.ok) {
        setErr(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={generate}
        className="flex flex-col gap-3 rounded border border-neutral-200 p-4"
      >
        <h3 className="text-sm font-medium text-neutral-700">生成报告草稿</h3>
        <div className="flex flex-wrap gap-3">
          <select
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
          >
            {students.length === 0 && <option value="">无在读学生</option>}
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
          />
          <input
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
          />
          <input
            type="text"
            placeholder="标题（可选）"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={pending || students.length === 0}
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {pending ? '生成中…' : '生成草稿'}
          </button>
        </div>
        {err && <p className="text-xs text-red-600">{err}</p>}
      </form>

      <ul className="flex flex-col gap-3">
        {reports.length === 0 && (
          <li className="rounded border border-neutral-200 px-4 py-3 text-sm text-neutral-500">
            暂无报告
          </li>
        )}
        {reports.map((r) => (
          <ReportItem
            key={r.id}
            report={r}
            studentName={nameOf.get(r.studentId) ?? r.studentId}
            onRun={run}
            pending={pending}
          />
        ))}
      </ul>
    </div>
  )
}

function ReportItem({
  report,
  studentName,
  onRun,
  pending,
}: {
  report: ReportRow
  studentName: string
  onRun: (fn: () => Promise<unknown>) => void
  pending: boolean
}) {
  const [text, setText] = useState(report.narrative ?? '')
  const approved = report.status === 'approved'
  const period =
    report.periodStart && report.periodEnd ? `${report.periodStart} ~ ${report.periodEnd}` : '—'

  return (
    <li className="flex flex-col gap-3 rounded border border-neutral-200 px-4 py-3">
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

      {approved ? (
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
        {!approved && (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => onRun(() => updateReportNarrative({ id: report.id, narrative: text }))}
              className="rounded border border-neutral-300 px-3 py-1 text-sm text-neutral-700 disabled:opacity-50"
            >
              保存
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm('批准后报告将定稿，不可再修改。确定继续？')) {
                  onRun(() => approveReport(report.id))
                }
              }}
              className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              批准
            </button>
          </>
        )}
        <a
          href={`/api/reports/${report.id}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded border border-neutral-300 px-3 py-1 text-sm text-neutral-700"
        >
          下载 PDF
        </a>
      </div>
    </li>
  )
}
