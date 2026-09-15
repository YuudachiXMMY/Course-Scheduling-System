'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/auth/client'

// Ends the better-auth session (clears the cookie) then bounces to /login. The dashboard layout
// guard also redirects unauthenticated requests, so router.refresh() re-runs it as a backstop.
export default function LogoutButton() {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function signOut() {
    startTransition(async () => {
      await authClient.signOut()
      router.push('/login')
      router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      className="text-neutral-500 hover:text-neutral-900 hover:underline disabled:opacity-50"
    >
      {pending ? '退出中…' : '退出登录'}
    </button>
  )
}
