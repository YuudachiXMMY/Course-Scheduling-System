'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { provisionPortalAccount } from './portal-actions'

// Owner/admin affordance on the students list: mint a parent/student login for this student. On
// success, the synthesized login email is shown so the tutor can hand it (+ the password they set)
// to the family — WeChat parents have no real email.
export default function PortalAccountForm({
  studentId,
  studentName,
}: {
  studentId: string
  studentName: string
}) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<'parent' | 'student'>('parent')
  const [name, setName] = useState('')
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function submit() {
    setError(null)
    setEmail(null)
    startTransition(async () => {
      const res = await provisionPortalAccount({
        studentId,
        name: name.trim() || studentName,
        kind,
        loginId: loginId.trim() || undefined,
        password,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setEmail(res.email)
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
        className="self-start rounded border border-neutral-300 px-3 py-1 text-xs"
        onClick={() => setOpen(true)}
      >
        开通登录
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-neutral-200 p-3">
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
          placeholder={`显示名（默认「${studentName}」）`}
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
      {email && (
        <p className="text-xs text-green-700">
          已开通！登录邮箱：<span className="font-mono">{email}</span>（请连同密码转交家长/学生）
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          className="rounded bg-neutral-900 px-3 py-1 text-xs text-white disabled:opacity-50"
          onClick={submit}
        >
          {pending ? '开通中…' : '开通'}
        </button>
        <button
          type="button"
          disabled={pending}
          className="rounded border border-neutral-300 px-3 py-1 text-xs"
          onClick={() => setOpen(false)}
        >
          关闭
        </button>
      </div>
    </div>
  )
}
