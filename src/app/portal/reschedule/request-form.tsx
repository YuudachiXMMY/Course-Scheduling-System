'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { DateTime } from 'luxon'
import { createRescheduleRequest, cancelRescheduleRequest } from './actions'

const ZONE = 'Asia/Shanghai'

export interface LessonOption {
  studentId: string
  studentName: string
  lessonId: string
  title: string | null
  startAt: string // ISO UTC
  endAt: string // ISO UTC
}

export interface RequestRow {
  id: string
  status: string
  reason: string | null
  requestedStartAt: string | null
  requestedEndAt: string | null
  createdAt: string | null
}

const STATUS_LABEL: Record<string, string> = {
  pending: '待处理',
  approved: '已通过',
  rejected: '已拒绝',
  canceled: '已取消',
}

// ISO UTC instant → Asia/Shanghai wall-clock string for a <input type="datetime-local">.
function toLocalInput(iso: string): string {
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(ZONE).toFormat("yyyy-MM-dd'T'HH:mm")
}
// Asia/Shanghai wall-clock ("YYYY-MM-DDTHH:mm") → ISO with offset so the server parses the correct
// instant regardless of its own timezone.
function fromLocalInput(local: string): string {
  return DateTime.fromISO(local, { zone: ZONE }).toISO() ?? local
}
function fmtDisplay(iso: string | null): string {
  if (!iso) return '—'
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(ZONE).toFormat('MM月dd日 HH:mm')
}

export default function RequestForm({
  options,
  requests,
}: {
  options: LessonOption[]
  requests: RequestRow[]
}) {
  const [lessonId, setLessonId] = useState(options[0]?.lessonId ?? '')
  const selected = useMemo(() => options.find((o) => o.lessonId === lessonId), [options, lessonId])
  const [start, setStart] = useState(selected ? toLocalInput(selected.startAt) : '')
  const [end, setEnd] = useState(selected ? toLocalInput(selected.endAt) : '')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function onPickLesson(id: string) {
    setLessonId(id)
    const opt = options.find((o) => o.lessonId === id)
    if (opt) {
      setStart(toLocalInput(opt.startAt))
      setEnd(toLocalInput(opt.endAt))
    }
  }

  function submit() {
    setError(null)
    const opt = options.find((o) => o.lessonId === lessonId)
    if (!opt) {
      setError('请选择要改期的课节')
      return
    }
    startTransition(async () => {
      const res = await createRescheduleRequest({
        studentId: opt.studentId,
        lessonId: opt.lessonId,
        requestedStartAt: fromLocalInput(start),
        requestedEndAt: fromLocalInput(end),
        reason: reason || undefined,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setReason('')
      router.refresh()
    })
  }

  function cancel(id: string) {
    setError(null)
    startTransition(async () => {
      const res = await cancelRescheduleRequest(id)
      if (!res.ok) {
        setError(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded border border-neutral-200 p-4">
        <h3 className="text-sm font-medium text-neutral-700">申请改期</h3>
        {options.length === 0 ? (
          <p className="text-sm text-neutral-500">近期暂无可申请改期的课节。</p>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-sm">
              选择课节
              <select
                data-testid="reschedule-lesson-select"
                className="rounded border border-neutral-300 px-2 py-1"
                value={lessonId}
                onChange={(e) => onPickLesson(e.target.value)}
              >
                {options.map((o) => (
                  <option key={o.lessonId} value={o.lessonId}>
                    {o.studentName} · {o.title ?? '课节'} · {fmtDisplay(o.startAt)}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                新的开始时间
                <input
                  data-testid="reschedule-start-input"
                  type="datetime-local"
                  className="rounded border border-neutral-300 px-2 py-1"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                新的结束时间
                <input
                  data-testid="reschedule-end-input"
                  type="datetime-local"
                  className="rounded border border-neutral-300 px-2 py-1"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              原因（选填）
              <textarea
                data-testid="reschedule-reason"
                className="rounded border border-neutral-300 px-2 py-1"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div>
              <button
                data-testid="reschedule-submit"
                type="button"
                onClick={submit}
                disabled={pending}
                className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                {pending ? '提交中…' : '提交申请'}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-neutral-700">我的申请（{requests.length}）</h3>
        <ul className="divide-y divide-neutral-200 rounded border border-neutral-200">
          {requests.length === 0 && (
            <li className="px-4 py-3 text-sm text-neutral-500">暂无申请</li>
          )}
          {requests.map((r) => (
            <li
              key={r.id}
              data-testid="reschedule-row"
              data-status={r.status}
              className="flex items-center justify-between px-4 py-3 text-sm"
            >
              <div className="flex flex-col">
                <span>
                  期望：{fmtDisplay(r.requestedStartAt)} – {fmtDisplay(r.requestedEndAt)}
                </span>
                {r.reason && <span className="text-xs text-neutral-500">原因：{r.reason}</span>}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-neutral-600">
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
                {r.status === 'pending' && (
                  <button
                    data-testid="reschedule-cancel"
                    type="button"
                    onClick={() => cancel(r.id)}
                    disabled={pending}
                    className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50"
                  >
                    取消
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
