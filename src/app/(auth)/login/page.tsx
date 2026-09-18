'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/auth/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const { error } = await authClient.signIn.email({ email, password })
    setPending(false)
    if (error) {
      setError(error.message ?? '登录失败')
      return
    }
    // Route by role via the root dispatcher (parent/student → /portal, else → /dashboard).
    router.push('/')
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">登录</h1>
      <label className="flex flex-col gap-1 text-sm">
        邮箱
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded border border-neutral-300 px-3 py-2"
          autoComplete="email"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        密码
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded border border-neutral-300 px-3 py-2"
          autoComplete="current-password"
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-3 py-2 text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {pending ? '登录中…' : '登录'}
      </button>
    </form>
  )
}
