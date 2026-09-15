'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { DateTime } from 'luxon'
import { approveRescheduleRequest, rejectRescheduleRequest } from './actions'
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
  const [pending, startTransition] = useTransition()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [conflicts, setConflicts] = useState<Record<string, ConflictInfo>>({})
  const router = useRouter()

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
    startTransition(async () => {
      const res = await approveRescheduleRequest(id)
      if (res.ok) {
        router.refresh()
        return
      }
      if ('conflicts' in res) {
        setConflicts((c) => ({ ...c, [id]: { conflicts: res.conflicts, suggestions: res.suggestions } }))
      } else {
        setErrors((e) => ({ ...e, [id]: res.error }))
      }
    })
  }

  function reject(id: string) {
    clearRow(id)
    startTransition(async () => {
      const res = await rejectRescheduleRequest(id)
      if (!res.ok) {
        setErrors((e) => ({ ...e, [id]: res.error }))
        return
      }
      router.refresh()
    })
  }

  if (requests.length === 0) {
    return <p className="text-sm text-neutral-500">暂无待处理的改期申请。</p>
  }

  return (
    <ul className="divide-y divide-neutral-200 rounded border border-neutral-200">
      {requests.map((r) => {
        const conflict = conflicts[r.id]
        return (
          <li key={r.id} className="flex flex-col gap-2 px-4 py-3 text-sm">
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
                    type="button"
                    onClick={() => approve(r.id)}
                    disabled={pending}
                    className="rounded bg-neutral-900 px-3 py-1 text-xs text-white disabled:opacity-50"
                  >
                    通过
                  </button>
                  <button
                    type="button"
                    onClick={() => reject(r.id)}
                    disabled={pending}
                    className="rounded border border-red-300 px-3 py-1 text-xs text-red-600 disabled:opacity-50"
                  >
                    拒绝
                  </button>
                </div>
              )}
            </div>
            {errors[r.id] && <p className="text-xs text-red-600">{errors[r.id]}</p>}
            {conflict && (
              <div className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
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
  )
}
