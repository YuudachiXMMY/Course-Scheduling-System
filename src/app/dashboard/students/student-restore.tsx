'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { restoreStudent } from './actions'

// Restore button for an archived student (paired with StudentForm's 归档 action).
export default function StudentRestore({ studentId }: { studentId: string }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function restore() {
    setError(null)
    startTransition(async () => {
      try {
        // B29: restoreStudent 现在返回判别式 {ok,error}（不再抛业务错误）——按 res.ok 分支。
        const res = await restoreStudent(studentId)
        if (!res.ok) {
          setError(res.error)
          return
        }
        router.refresh()
      } catch (e) {
        // requireAuthContext/requirePermission 等框架级错误仍会抛——兜底提示。
        setError(e instanceof Error ? e.message : '恢复失败')
      }
    })
  }

  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        disabled={pending}
        className="rounded border border-neutral-300 px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        onClick={restore}
      >
        {pending ? '恢复中…' : '恢复'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  )
}
