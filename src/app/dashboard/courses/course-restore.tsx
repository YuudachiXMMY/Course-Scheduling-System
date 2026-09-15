'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { restoreCourse } from './actions'

// Restore button for an archived course template (paired with CourseForm's 归档 action).
export default function CourseRestore({ courseId }: { courseId: string }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  return (
    <button
      type="button"
      disabled={pending}
      className="rounded border border-neutral-300 px-3 py-1 text-xs text-neutral-700 disabled:opacity-50"
      onClick={() =>
        startTransition(async () => {
          await restoreCourse(courseId)
          router.refresh()
        })
      }
    >
      {pending ? '恢复中…' : '恢复'}
    </button>
  )
}
