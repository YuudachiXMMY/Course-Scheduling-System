'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createPortalUser } from './user-actions'

// Owner/admin affordance on the 家长 tab: mint a parent/student login WITHOUT binding a student yet.
// On success the (synthesized or entered) login email is shown so the tutor can hand it (+ the
// password they set) to the family. Mirrors students/portal-account-form.tsx.
export default function UserForm() {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<'parent' | 'student'>('parent')
  const [name, setName] = useState('')
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState<string | null>(null)
  const [created, setCreated] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function submit() {
    setError(null)
    setEmail(null)
    startTransition(async () => {
      const res = await createPortalUser({
        name: name.trim(),
        kind,
        loginId: loginId.trim() || undefined,
        password,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setEmail(res.email)
      setCreated(res.created)
      setName('')
      setLoginId('')
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
        新建用户
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 shadow-sm">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          账号类型
          <select
            className="rounded border border-neutral-300 px-2 py-1 text-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value as 'parent' | 'student')}
          >
            <option value="parent">家长</option>
            <option value="student">学生</option>
          </select>
        </label>
        <input
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
          placeholder="显示名"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
          placeholder="登录邮箱（选填，留空自动生成）"
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
        />
        <input
          type="password"
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
          placeholder="密码（至少 8 位）"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {email &&
        (created ? (
          <p className="text-xs text-green-700">
            已新建！登录邮箱：<span className="font-mono">{email}</span>（请连同密码转交家长/学生）
          </p>
        ) : (
          // MEDIUM fix: this email is an EXISTING member of this org — no account was created and the
          // password entered above was IGNORED. Do not claim "已新建" or imply a new password was set.
          <p className="text-xs text-amber-700">
            该邮箱已是本机构账号，<span className="font-medium">未新建、密码未修改</span>。登录邮箱：
            <span className="font-mono">{email}</span>；如需把它关联到学生，请用下方各账号的「关联学生…」。
          </p>
        ))}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          className="rounded bg-neutral-900 px-3 py-1 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
          onClick={submit}
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
    </div>
  )
}
