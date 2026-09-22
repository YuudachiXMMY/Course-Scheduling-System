'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { changeOwnPassword } from '@/auth/account-actions'
import { MIN_PASSWORD_LENGTH } from '@/auth/password-policy'

// Self-service "输入当前密码修改" form, shared by /dashboard/account (staff) and /portal/account
// (parent/student). Client-side we only guard the obvious (new === confirm, min length) for fast feedback;
// the Server Action + better-auth re-validate and verify the current password authoritatively. On success
// the fields clear and we refresh so any layout state re-reads the session.
export default function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [ok, setOk] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function submit() {
    setError(null)
    setOk(false)
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`新密码至少 ${MIN_PASSWORD_LENGTH} 位`)
      return
    }
    if (newPassword !== confirm) {
      setError('两次输入的新密码不一致')
      return
    }
    startTransition(async () => {
      const res = await changeOwnPassword({ currentPassword, newPassword })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setOk(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirm('')
      router.refresh()
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="flex max-w-sm flex-col gap-3 rounded-lg border border-neutral-200 p-4 shadow-sm"
    >
      <label className="flex flex-col gap-1 text-sm">
        当前密码
        <input
          type="password"
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        新密码（至少 {MIN_PASSWORD_LENGTH} 位）
        <input
          type="password"
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        确认新密码
        <input
          type="password"
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
      </label>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {ok && <p className="text-xs text-green-700">密码已修改，其他设备的登录已失效。</p>}
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded bg-neutral-900 px-3 py-1 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {pending ? '修改中…' : '修改密码'}
      </button>
    </form>
  )
}
