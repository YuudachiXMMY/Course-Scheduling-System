'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createReportDraft, type ReportResult } from '@/app/dashboard/reports/actions'
import { ReportItem } from '@/app/dashboard/reports/report-item'
import { useFlash } from '@/app/dashboard/_components/use-flash'
import type { ReportRow } from '@/app/dashboard/reports/data'
import type { SectionStudent } from './data'

export default function SectionReportPanel({
  sectionId,
  roster,
  reports,
  defaultFrom,
  defaultTo,
  canWrite,
  initialStudent,
  initialPeriod,
  initialFrom,
  initialTo,
}: {
  sectionId: string
  roster: SectionStudent[]
  reports: ReportRow[]
  defaultFrom: string
  defaultTo: string
  canWrite: boolean
  initialStudent?: string
  initialPeriod?: string
  initialFrom?: string
  initialTo?: string
}) {
  const [studentId, setStudentId] = useState(initialStudent ?? roster[0]?.id ?? '')
  const [period, setPeriod] = useState<'month' | 'custom'>(
    initialPeriod === 'custom' ? 'custom' : 'month',
  )
  const [from, setFrom] = useState(initialFrom ?? defaultFrom)
  const [to, setTo] = useState(initialTo ?? defaultTo)
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const { flash, show } = useFlash()
  const router = useRouter()
  const nameOf = new Map(roster.map((s) => [s.id, s.name]))

  // Save / approve on an existing report (used by ReportItem).
  function run(fn: () => Promise<ReportResult>) {
    setErr(null)
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) {
        setErr(res.error)
        return
      }
      show('已保存')
      router.refresh()
    })
  }

  function generate(e: FormEvent) {
    e.preventDefault()
    const periodStart = period === 'month' ? defaultFrom : from
    const periodEnd = period === 'month' ? defaultTo : to
    if (!studentId || !periodStart || !periodEnd) {
      setErr('请选择学生与时间段')
      return
    }
    setErr(null)
    startTransition(async () => {
      // createReportDraft returns problems as data (missing ANTHROPIC_API_KEY etc.) so a failure shows
      // inline instead of the redacted React #441. sectionId is provenance only — aggregation follows
      // the student's enrollments in the window.
      const res = await createReportDraft({ studentId, sectionId, periodStart, periodEnd })
      if (!res.ok) {
        setErr(res.error)
        return
      }
      show('已生成草稿')
      router.refresh()
    })
  }

  const pill = (on: boolean) =>
    `rounded px-2 py-1 ${on ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-50'}`

  return (
    <div className="flex flex-col gap-6">
      {canWrite && roster.length === 0 && (
        <p className="text-sm text-neutral-500">本班级暂无在读学生，无法生成报告。</p>
      )}

      {canWrite && roster.length > 0 && (
        <form
          onSubmit={generate}
          className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4 shadow-sm"
        >
          <h3 className="text-sm font-medium text-neutral-700">生成报告草稿</h3>
          <div className="flex flex-wrap items-center gap-3">
            {/* B35: 报告生成器的表单控件补可访问名称（select 学生 / 起止日期），否则屏幕阅读器无名可念。 */}
            <select
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              aria-label="学生"
              className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
            >
              {roster.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <div
              role="radiogroup"
              aria-label="报告时间段"
              className="flex items-center gap-1 rounded border border-neutral-300 p-0.5 text-xs"
            >
              <button
                type="button"
                role="radio"
                aria-checked={period === 'month'}
                onClick={() => setPeriod('month')}
                className={pill(period === 'month')}
              >
                本月
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={period === 'custom'}
                onClick={() => setPeriod('custom')}
                className={pill(period === 'custom')}
              >
                自定义
              </button>
            </div>
            {period === 'month' ? (
              <span className="text-xs text-neutral-500 tabular-nums">
                {defaultFrom} ~ {defaultTo}
              </span>
            ) : (
              <>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  aria-label="开始日期"
                  className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
                />
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  aria-label="结束日期"
                  className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
                />
              </>
            )}
            <button
              type="submit"
              disabled={pending}
              className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {pending ? '生成中…' : '生成草稿'}
            </button>
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
          {flash && (
            <span aria-live="polite" className="text-xs text-green-700">
              {flash}
            </span>
          )}
        </form>
      )}

      <ul className="flex flex-col gap-3">
        {reports.length === 0 && (
          <li className="rounded-lg border border-neutral-200 px-4 py-8 text-center text-sm text-neutral-500">
            该班级学生暂无报告
          </li>
        )}
        {reports.map((r) => (
          <ReportItem
            key={r.id}
            report={r}
            studentName={nameOf.get(r.studentId) ?? r.studentId}
            onRun={run}
            pending={pending}
            readOnly={!canWrite}
          />
        ))}
      </ul>
    </div>
  )
}
