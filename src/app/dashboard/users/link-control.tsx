'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { linkPortalUser, unlinkPortalUser } from './user-actions'

type LinkOption = { value: string; label: string }

// Assign picker — one <select> of not-yet-linked targets + an 关联 button. Reused in BOTH directions;
// exactly ONE of fixedUserId / fixedStudentId is supplied by the caller, and the picked option fills
// the other side (relationship is inferred server-side from the account's member role):
//   - 家长 tab: fixedUserId, options = assignable students (value = studentId).
//   - 学生 tab: fixedStudentId, options = assignable accounts (value = userId).
// Props are all serializable (no function props) so this Client Component can be rendered by the RSC tabs.
type LinkControlProps = { label: string; options: LinkOption[] } & (
  | { fixedUserId: string; fixedStudentId?: undefined }
  | { fixedStudentId: string; fixedUserId?: undefined }
)

// TS1：用判别式联合表达"fixedUserId / fixedStudentId 恰有其一"的互斥契约，在两个调用点编译期强制。
// 故意不解构这两个字段，让 TS 能把它们与判别关联，提交时靠控制流收窄而非 `!` 非空断言。
export function LinkControl(props: LinkControlProps) {
  const { label, options } = props
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  if (options.length === 0) return null

  function submit() {
    if (!value) return
    setError(null)
    startTransition(async () => {
      const input =
        props.fixedUserId !== undefined
          ? { userId: props.fixedUserId, studentId: value }
          : { userId: value, studentId: props.fixedStudentId }
      const res = await linkPortalUser(input)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setValue('')
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className="rounded border border-neutral-300 px-2 py-1 text-xs"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label={label}
      >
        <option value="">{label}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={pending || !value}
        className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
        onClick={submit}
      >
        {pending ? '关联中…' : '关联'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}

// Small inline 解绑 button for an existing (user, student) link.
export function UnlinkButton({ userId, studentId }: { userId: string; studentId: string }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function submit() {
    setError(null)
    startTransition(async () => {
      const res = await unlinkPortalUser(userId, studentId)
      if (!res.ok) {
        setError(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        className="rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] text-neutral-500 hover:bg-neutral-50 disabled:opacity-50"
        onClick={submit}
      >
        {pending ? '解绑中…' : '解绑'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </>
  )
}
