import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import PushSubscribeButton from '@/components/push-subscribe-button'
import { listNotifications } from './data'
import NotificationPanel from './notification-panel'

// Staff notification center. Two-layer auth — the page gates (below) and each action re-gates.
export default async function NotificationsPage() {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { notification: ['list'] })
  const items = await listNotifications(ctx)

  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <h2 className="text-lg font-semibold">通知</h2>
      <NotificationPanel items={items} />
      <PushSubscribeButton />
    </section>
  )
}
