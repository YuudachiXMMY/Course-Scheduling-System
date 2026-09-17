'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createReportDraft, type ReportResult } from './actions'
import type { ReportRow, StudentOption } from './data'
import { ReportItem } from './report-item'

export default function ReportPanel({
  students,
  reports,
  readOnly = false,
}: {
  students: StudentOption[]
  reports: ReportRow[]
  // B16: 由 page.tsx 依 report:update 权限计算并下传；只读时隐藏生成表单、锁定每条报告的编辑/批准 UI。
  readOnly?: boolean
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

  // All mutating report actions now return problems as data (ReportResult) so a redacted server
  // error never reaches the client as the cryptic "React error #441"; show res.error inline instead.
  function run(fn: () => Promise<ReportResult>) {
    setErr(null)
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) {
        setErr(res.error)
        return
      }
      router.refresh()
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
      // failure shows a helpful message instead of the redacted "React error #441" crash. The
      // try/catch additionally covers a throw before the action's internal guard (auth/permission).
      try {
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
      } catch (e) {
        setErr(e instanceof Error ? e.message : '操作失败')
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* B16: 生成草稿属写操作，只读角色（仅 report:list）不渲染该表单。 */}
      {!readOnly && (
        <form
          onSubmit={generate}
          className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4 shadow-sm"
        >
          <h3 className="text-sm font-medium text-neutral-700">生成报告草稿</h3>
          <div className="flex flex-wrap gap-3">
            {/* B18: 为 select/date/标题控件补可访问名称（WCAG 1.3.1/3.3.2/4.1.2）。 */}
            <select
              aria-label="选择学生"
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
              aria-label="报告开始日期"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
            />
            <input
              type="date"
              aria-label="报告结束日期"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
            />
            <input
              type="text"
              aria-label="报告标题（可选）"
              placeholder="标题（可选）"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
            />
            <button
              type="submit"
              disabled={pending || students.length === 0}
              className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {pending ? '生成中…' : '生成草稿'}
            </button>
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
        </form>
      )}

      <ul className="flex flex-col gap-3">
        {reports.length === 0 && (
          <li className="rounded-lg border border-neutral-200 px-4 py-8 text-center text-sm text-neutral-500">
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
            readOnly={readOnly}
          />
        ))}
      </ul>
    </div>
  )
}
