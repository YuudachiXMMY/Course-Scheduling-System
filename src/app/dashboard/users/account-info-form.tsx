'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateUserInfo } from './user-actions'

// Per-row 「编辑」 affordance for a user account (家长 / 教师 / 管理员): edit display name + login email.
// Serializable props only (no function props) so an RSC tab can render it. The server tab decides WHETHER
// to render it (tier + self visibility); the Server Action + core re-check every rule (defence in depth).
// Collapsed → a small 「编辑」 button; expanded → an inline name/email form. On success it collapses and the
// router refreshes so the row shows the new values.
export default function AccountInfoForm({
  userId,
  name: initialName,
  email: initialEmail,
}: {
  userId: string
  name: string
  email: string
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(initialName)
  const [email, setEmail] = useState(initialEmail)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function submit() {
    setError(null)
    startTransition(async () => {
      const res = await updateUserInfo(userId, { name: name.trim(), email: email.trim() })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setOpen(false)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50"
        onClick={() => {
          // Re-seed from the latest server values each time the form is opened (a concurrent edit
          // elsewhere may have changed them since mount).
          setName(initialName)
          setEmail(initialEmail)
          setError(null)
          setOpen(true)
        }}
      >
        编辑
      </button>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="flex flex-wrap items-center gap-1"
    >
      <input
        className="rounded border border-neutral-300 px-2 py-0.5 text-xs"
        placeholder="显示名"
        aria-label="显示名"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        type="email"
        className="rounded border border-neutral-300 px-2 py-0.5 text-xs"
        placeholder="登录邮箱"
        aria-label="登录邮箱"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="off"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-2 py-0.5 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {pending ? '保存中…' : '保存'}
      </button>
      <button
        type="button"
        disabled={pending}
        className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50"
        onClick={() => {
          setOpen(false)
          setError(null)
        }}
      >
        取消
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  )
}
