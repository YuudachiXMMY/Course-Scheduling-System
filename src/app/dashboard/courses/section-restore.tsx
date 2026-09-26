'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { restoreSection } from './actions'

// Restore button for an archived section (paired with SectionDangerZone's 归档班级 action). Mirrors
// CourseRestore. restoreSection returns {ok,error}; a failed restore just leaves the row archived.
export default function SectionRestore({ sectionId }: { sectionId: string }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  return (
    <button
      type="button"
      disabled={pending}
      className="rounded border border-neutral-300 px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
      onClick={() =>
        startTransition(async () => {
          await restoreSection(sectionId)
          router.refresh()
        })
      }
    >
      {pending ? '恢复中…' : '恢复'}
    </button>
  )
}
