'use client'

import { useEffect, useState, useTransition } from 'react'
import { subscribeToPush, unsubscribeFromPush } from '@/lib/push-client'
import { subscribeToPushAction, unsubscribeFromPushAction } from '@/app/push-actions'

// P7b: user-gesture push opt-in, shared by both notification centers. Renders nothing when push is
// not configured at build (no NEXT_PUBLIC_VAPID_PUBLIC_KEY). On an unsupported browser the click
// simply reports it can't enable — subscribeToPush() returns null. The permission prompt fires ONLY
// inside the click handler (never on load — P3-10 invariant).
export default function PushSubscribeButton() {
  const [pending, startTransition] = useTransition()
  const [subscribed, setSubscribed] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

  useEffect(() => {
    // Reflect an already-registered subscription. setState only inside the async .then callback so
    // this never triggers a synchronous cascading render.
    if (!('serviceWorker' in navigator)) return
    let cancelled = false
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((s) => {
        if (!cancelled) setSubscribed(!!s)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (!vapidKey) return null // push not configured at build → hide the button

  function enable() {
    setMsg(null)
    startTransition(async () => {
      const sub = await subscribeToPush()
      if (!sub) {
        setMsg('无法启用推送(需支持的浏览器并授予通知权限)')
        return
      }
      const res = await subscribeToPushAction(sub)
      if (res.ok) {
        setSubscribed(true)
        setMsg('已启用推送通知')
      } else {
        setMsg(res.error)
      }
    })
  }

  function disable() {
    setMsg(null)
    startTransition(async () => {
      const endpoint = await unsubscribeFromPush()
      if (endpoint) await unsubscribeFromPushAction(endpoint)
      setSubscribed(false)
      setMsg('已关闭推送通知')
    })
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={subscribed ? disable : enable}
        disabled={pending}
        className="rounded border border-neutral-300 px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
      >
        {subscribed ? '🔕 关闭推送通知' : '🔔 启用推送通知'}
      </button>
      {msg && (
        <span aria-live="polite" className="text-xs text-neutral-500">
          {msg}
        </span>
      )}
    </div>
  )
}
