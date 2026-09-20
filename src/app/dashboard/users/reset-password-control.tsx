'use client'

import { useState, useTransition } from 'react'
import { resetUserPassword } from './staff-actions'

// Per-row "重置密码" control for the users page (all four tabs). Serializable props only (no function
// props) so an RSC tab can render it. The server tab decides WHETHER to render it (tier + self visibility);
// the Server Action + core re-check every rule (defence in depth). On success the input collapses and a
// short confirmation shows — the operator hands the new password to the family/colleague out-of-band.
export default function ResetPasswordControl({
  targetUserId,
  label = '重置密码',
}: {
  targetUserId: string
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    if (password.length < 8) {
      setError('密码至少 12 位')
      return
    }
    startTransition(async () => {
      const res = await resetUserPassword(targetUserId, password)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setPassword('')
      setOpen(false)
      setDone(true)
    })
  }

  if (!open) {
    return (
      <span className="flex items-center gap-1">
        <button
          type="button"
          className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50"
          onClick={() => {
            setDone(false)
            setOpen(true)
          }}
        >
          {label}
        </button>
        {done && <span className="text-xs text-green-700">已重置</span>}
      </span>
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
        type="password"
        className="rounded border border-neutral-300 px-2 py-0.5 text-xs"
        placeholder="新密码（至少 12 位）"
        aria-label="新密码"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-2 py-0.5 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {pending ? '重置中…' : '确认'}
      </button>
      <button
        type="button"
        disabled={pending}
        className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50"
        onClick={() => {
          setOpen(false)
          setError(null)
          setPassword('')
        }}
      >
        取消
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  )
}
