import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import PushSubscribeButton from '@/components/push-subscribe-button'
import { listNotifications } from './data'
import NotificationPanel from './notification-panel'

// Parent/student notification center. Row scope is userId-based (loader/core filter on ctx.userId),
// so a parent sees ONLY their own notifications. Page gates; each action re-gates.
export default async function PortalNotificationsPage() {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { notification: ['list'] })
  const items = await listNotifications(ctx)

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <h2 className="text-lg font-semibold">通知</h2>
      <NotificationPanel items={items} />
      <PushSubscribeButton />
    </section>
  )
}
