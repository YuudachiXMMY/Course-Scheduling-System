'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { provisionPortalAccount } from './portal-actions'

// Owner/admin affordance on the students list: mint a parent/student login for this student. On
// success, the synthesized login email is shown so the tutor can hand it (+ the password they set)
// to the family — WeChat parents have no real email.
//
// `fixedKind` pins the account kind and hides the type <select> — the 学生 tab uses fixedKind="student"
// so the per-student "开通学生门户账号" affordance always mints a STUDENT login (parents are now managed
// on the 家长 tab, via UserForm). The prop stays optional for backward-compat, but the ONLY current call
// site pins it to "student", so the both-kinds <select> branch below is currently unexercised.
export default function PortalAccountForm({
  studentId,
  studentName,
  fixedKind,
  buttonLabel,
}: {
  studentId: string
  studentName: string
  fixedKind?: 'parent' | 'student'
  buttonLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<'parent' | 'student'>(fixedKind ?? 'parent')
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
        {buttonLabel ?? '开通登录'}
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
        {/* fixedKind 时（学生 tab 的「开通学生门户账号」）隐藏类型选择，kind 已固定为 student。 */}
        {!fixedKind && (
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
        )}
        <input
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
          placeholder={`显示名（默认「${studentName}」）`}
          aria-label="显示名"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
          placeholder="登录邮箱（选填，留空自动生成）"
          aria-label="登录邮箱"
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
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
      {email &&
        (created ? (
          <p className="text-xs text-green-700">
            已开通！登录邮箱：<span className="font-mono">{email}</span>（请连同密码转交家长/学生）
          </p>
        ) : (
          // MEDIUM fix (PR#32 class): this email was ALREADY a member of this org — no account was
          // created and the password entered above was IGNORED. The student is now linked, but do not
          // claim "已开通" or imply a new password was set. Mirrors users/user-form.tsx.
          <p className="text-xs text-amber-700">
            该邮箱已是本机构账号，已关联到该学生；
            <span className="font-medium">未新建、密码未修改</span>
            。原有登录邮箱：<span className="font-mono">{email}</span>（沿用其既有密码）。
          </p>
        ))}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-neutral-900 px-3 py-1 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {pending ? '开通中…' : '开通'}
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
