'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { DateTime } from 'luxon'
import { markNotificationRead, markAllNotificationsRead } from './actions'
import type { NotificationRow } from './data'
import { APP_TIME_ZONE } from '@/lib/timezone'

const ZONE = APP_TIME_ZONE

function fmt(iso: string | null): string {
  if (!iso) return ''
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(ZONE).toFormat('MM月dd日 HH:mm')
}

export default function NotificationPanel({ items }: { items: NotificationRow[] }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const hasUnread = items.some((i) => i.readAt === null)

  function markRead(id: string) {
    startTransition(async () => {
      const res = await markNotificationRead(id)
      if (res.ok) router.refresh()
    })
  }
  function markAll() {
    startTransition(async () => {
      const res = await markAllNotificationsRead()
      if (res.ok) router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-3">
      {hasUnread && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={markAll}
            disabled={pending}
            className="text-xs text-neutral-600 hover:text-neutral-900 hover:underline disabled:opacity-50"
          >
            全部标为已读
          </button>
        </div>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-neutral-500">暂无通知。</p>
      ) : (
        <ul
          className="divide-y divide-neutral-200 rounded-lg border border-neutral-200"
          data-testid="notification-list"
        >
          {items.map((n) => {
            const unread = n.readAt === null
            const content = (
              <div className="flex flex-1 flex-col gap-1">
                <div className="flex items-center gap-2">
                  {unread && (
                    <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                  )}
                  <span className={unread ? 'font-medium text-neutral-900' : 'text-neutral-700'}>
                    {n.title}
                  </span>
                </div>
                {n.body && <span className="text-xs text-neutral-500">{n.body}</span>}
                <span className="text-xs text-neutral-400">{fmt(n.createdAt)}</span>
              </div>
            )
            return (
              <li
                key={n.id}
                data-testid="notification-item"
                data-notification-id={n.id}
                className="flex items-start justify-between gap-3 px-4 py-3 text-sm"
              >
                {n.url ? (
                  <a href={n.url} className="flex-1 hover:underline">
                    {content}
                  </a>
                ) : (
                  content
                )}
                {unread && (
                  <button
                    type="button"
                    onClick={() => markRead(n.id)}
                    disabled={pending}
                    className="shrink-0 text-xs text-neutral-600 hover:text-neutral-900 hover:underline disabled:opacity-50"
                  >
                    标为已读
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
