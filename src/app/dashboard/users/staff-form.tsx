'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createStaffUser } from './staff-actions'
import type { CreateStaffInput } from '@/auth/staff'

// Create a staff login (teacher/assistant/admin). `roleOptions` is decided by the caller/tab and is the
// tier gate made visible: the 管理员 tab only passes an `admin` option, and only renders this form for a
// super admin — so a regular admin never even sees the affordance (the Server Action re-checks regardless).
// A staff login always uses a REAL email (they sign into /dashboard), so — unlike portal accounts — there
// is no synthesized-email fallback and a colliding email is refused server-side. Mirrors user-form.tsx.
export default function StaffForm({
  roleOptions,
}: {
  roleOptions: { value: string; label: string }[]
}) {
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState(roleOptions[0]?.value ?? 'teacher')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [okEmail, setOkEmail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function submit() {
    setError(null)
    setOkEmail(null)
    startTransition(async () => {
      const res = await createStaffUser({
        name: name.trim(),
        email: email.trim(),
        password,
        role: role as CreateStaffInput['role'],
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setOkEmail(email.trim())
      setName('')
      setEmail('')
      setPassword('')
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        className="self-start rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50"
        onClick={() => setOpen(true)}
      >
        新建账号
      </button>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 shadow-sm"
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {roleOptions.length > 1 && (
          <label className="flex flex-col gap-1 text-xs">
            账号类型
            <select
              className="rounded border border-neutral-300 px-2 py-1 text-sm"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              {roleOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <input
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
          placeholder="显示名"
          aria-label="显示名"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
          placeholder="登录邮箱"
          aria-label="登录邮箱"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
          placeholder="密码（至少 8 位）"
          aria-label="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {okEmail && (
        <p className="text-xs text-green-700">
          已新建账号！登录邮箱：<span className="font-mono">{okEmail}</span>（请连同密码转交本人）
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-neutral-900 px-3 py-1 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {pending ? '新建中…' : '新建'}
        </button>
        <button
          type="button"
          disabled={pending}
          className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50"
          onClick={() => setOpen(false)}
        >
          关闭
        </button>
      </div>
    </form>
  )
}
