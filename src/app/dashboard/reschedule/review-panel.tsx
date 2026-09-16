'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { DateTime } from 'luxon'
import { approveRescheduleRequest, rejectRescheduleRequest } from './actions'
import { useFlash } from '../_components/use-flash'
import type { ReviewRow } from './data'

const ZONE = 'Asia/Shanghai'

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(ZONE).toFormat('MM月dd日 HH:mm')
}

// Per-request conflict feedback after a failed approve (soft double-booking or GiST race). The
// request stays pending; the reviewer sees the conflicting lessons + suggested free slots.
interface ConflictInfo {
  conflicts: { id: string; title: string | null }[]
  suggestions: string[]
}

export default function ReviewPanel({
  requests,
  canReview,
}: {
  requests: ReviewRow[]
  canReview: boolean
}) {
  const [, startTransition] = useTransition()
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [conflicts, setConflicts] = useState<Record<string, ConflictInfo>>({})
  // Reject is two-step: the 拒绝 button opens an inline box for an OPTIONAL reason (persisted +
  // surfaced back to the parent in the portal), then 确认拒绝 commits. One box open at a time — a
  // reviewer works the queue sequentially.
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const { flash, show } = useFlash()
  const router = useRouter()

  // Per-row pending isolation: acting on one request must not disable the others' buttons.
  function setRowPending(id: string, on: boolean) {
    setPendingIds((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function clearRow(id: string) {
    setErrors((e) => ({ ...e, [id]: '' }))
    setConflicts((c) => {
      const next = { ...c }
      delete next[id]
      return next
    })
  }

  function approve(id: string) {
    clearRow(id)
    setRowPending(id, true)
    startTransition(async () => {
      try {
        const res = await approveRescheduleRequest(id)
        if (res.ok) {
          show('已通过')
          router.refresh()
          return
        }
        if ('conflicts' in res) {
          setConflicts((c) => ({
            ...c,
            [id]: { conflicts: res.conflicts, suggestions: res.suggestions },
          }))
        } else {
          setErrors((e) => ({ ...e, [id]: res.error }))
        }
      } finally {
        setRowPending(id, false)
      }
    })
  }

  function openReject(id: string) {
    clearRow(id)
    setRejectNote('')
    setRejectingId((cur) => (cur === id ? null : id))
  }

  function reject(id: string) {
    clearRow(id)
    setRowPending(id, true)
    const note = rejectNote.trim()
    startTransition(async () => {
      try {
        const res = await rejectRescheduleRequest(id, note || undefined)
        if (!res.ok) {
          setErrors((e) => ({ ...e, [id]: res.error }))
          return
        }
        setRejectingId(null)
        setRejectNote('')
        show('已拒绝')
        router.refresh()
      } finally {
        setRowPending(id, false)
      }
    })
  }

  return (
    <div className="flex flex-col gap-2">
      {flash && (
        <span aria-live="polite" className="text-xs text-green-700">
          {flash}
        </span>
      )}
      {requests.length === 0 ? (
        <p className="text-sm text-neutral-500">暂无待处理的改期申请。</p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
          {requests.map((r) => {
            const conflict = conflicts[r.id]
            return (
              <li
                key={r.id}
                data-testid="reschedule-request"
                data-request-id={r.id}
                className="flex flex-col gap-2 px-4 py-3 text-sm tabular-nums"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">
                      {r.studentName ?? '学生'} · {r.lessonTitle ?? '课节'}
                    </span>
                    <span className="text-xs text-neutral-500">
                      现时间：{fmt(r.currentStartAt)} – {fmt(r.currentEndAt)}
                    </span>
                    <span className="text-xs text-neutral-700">
                      期望：{fmt(r.requestedStartAt)} – {fmt(r.requestedEndAt)}
                    </span>
                    {r.reason && <span className="text-xs text-neutral-500">原因：{r.reason}</span>}
                  </div>
                  {canReview && (
                    <div className="flex shrink-0 gap-2">
                      <button
                        data-testid="reschedule-approve"
                        type="button"
                        onClick={() => approve(r.id)}
                        disabled={pendingIds.has(r.id)}
                        className="rounded bg-neutral-900 px-3 py-1 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
                      >
                        通过
                      </button>
                      <button
                        data-testid="reschedule-reject"
                        type="button"
                        onClick={() => openReject(r.id)}
                        disabled={pendingIds.has(r.id)}
                        aria-expanded={rejectingId === r.id}
                        className="rounded border border-red-300 px-3 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        拒绝
                      </button>
                    </div>
                  )}
                </div>
                {canReview && rejectingId === r.id && (
                  <div className="flex flex-col gap-2 rounded border border-red-200 bg-red-50 p-2">
                    <label className="flex flex-col gap-1 text-xs text-neutral-700">
                      拒绝原因（选填，将反馈给家长）
                      <textarea
                        data-testid="reschedule-reject-note"
                        rows={2}
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                        maxLength={500}
                        className="rounded border border-neutral-300 px-2 py-1 text-xs"
                      />
                    </label>
                    <div className="flex gap-2">
                      <button
                        data-testid="reschedule-reject-confirm"
                        type="button"
                        onClick={() => reject(r.id)}
                        disabled={pendingIds.has(r.id)}
                        className="rounded bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        确认拒绝
                      </button>
                      <button
                        type="button"
                        onClick={() => setRejectingId(null)}
                        className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
                {errors[r.id] && <p className="text-xs text-red-600">{errors[r.id]}</p>}
                {conflict && (
                  <div
                    data-testid="reschedule-conflict"
                    className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800"
                  >
                    <p>该时段与已有课节冲突，申请仍保持待处理：</p>
                    {conflict.conflicts.length > 0 && (
                      <p className="mt-1">
                        冲突：{conflict.conflicts.map((c) => c.title ?? '课节').join('、')}
                      </p>
                    )}
                    {conflict.suggestions.length > 0 && (
                      <p className="mt-1">建议时段：{conflict.suggestions.join('、')}</p>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
