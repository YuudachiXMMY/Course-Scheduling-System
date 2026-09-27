'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { restoreSection } from './actions'

// Restore button for an archived section (paired with SectionDangerZone's 归档班级 action). Mirrors
// CourseRestore. restoreSection returns {ok,error}; a failed restore just leaves the row archived.
export default function SectionRestore({ sectionId }: { sectionId: string }) {
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const router = useRouter()

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        className="rounded border border-neutral-300 px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        onClick={() =>
          startTransition(async () => {
            // restoreSection returns {ok,error}, but requireAuthContext() runs BEFORE its own try/catch,
            // so an expired-session throw would otherwise become an unhandled rejection in this event
            // handler. Catch it and surface inline instead of bubbling to error.tsx.
            setErr(null)
            try {
              const res = await restoreSection(sectionId)
              if (!res.ok) {
                setErr(res.error)
                return
              }
              router.refresh()
            } catch (e) {
              setErr(e instanceof Error ? e.message : '恢复失败')
            }
          })
        }
      >
        {pending ? '恢复中…' : '恢复'}
      </button>
      {err && (
        <span aria-live="polite" className="text-xs text-red-600">
          {err}
        </span>
      )}
    </div>
  )
}
