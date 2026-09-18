import type { ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { getAuthContext } from '@/auth/context'
import { isPortalRole } from '@/auth/portal'
import { forTenant } from '@/db/tenant'
import { portalLink } from '@/db/schema'
import { unreadCountForUserCore } from '@/lib/notification-core'
import LogoutButton from '@/app/dashboard/logout-button'
import ConsentGate from './consent-gate'

// Role-gated portal shell (parent/student only). UX-level guard ONLY — every page/action re-checks
// via requireAuthContext + requirePermission + the portalLink row scope. Renders a one-time consent
// gate (P7a-9) in place of the children until the user has acknowledged the data notice.
export default async function PortalLayout({ children }: { children: ReactNode }) {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!isPortalRole(ctx.role)) redirect('/dashboard')

  const links = await forTenant(ctx).select(portalLink, eq(portalLink.userId, ctx.userId))
  const needsConsent = links.length > 0 && links.some((l) => !l.consentedAt)
  // Unread badge lives in the layout (always visible), NOT a page — pages render inside the consent
  // gate and would be hidden until consent. ctx is available here (Server Component).
  const unread = await unreadCountForUserCore(ctx)

  return (
    <div className="min-h-dvh">
      <header className="flex flex-col gap-3 border-b border-neutral-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-base font-semibold">课程门户</h1>
        <nav className="flex gap-4 text-sm">
          <Link href="/portal" className="text-neutral-700 hover:text-neutral-900 hover:underline">
            我的课表
          </Link>
          <Link
            href="/portal/reschedule"
            className="text-neutral-700 hover:text-neutral-900 hover:underline"
          >
            改期申请
          </Link>
          <Link
            href="/portal/notifications"
            className="text-neutral-700 hover:text-neutral-900 hover:underline"
          >
            通知
            {unread > 0 && (
              <>
                {/* B41：视觉徽章仅呈现数字，对 AT 隐藏；另补 sr-only 文本，让读屏能感知未读数量。 */}
                <span
                  aria-hidden
                  className="ml-1 inline-block rounded-full bg-red-500 px-1.5 text-[10px] font-medium text-white"
                >
                  {unread}
                </span>
                <span className="sr-only">（{unread} 条未读通知）</span>
              </>
            )}
          </Link>
          <LogoutButton />
        </nav>
      </header>
      <main className="p-6">{needsConsent ? <ConsentGate /> : children}</main>
      <footer className="px-6 pb-6 text-xs text-neutral-500">
        <Link href="/privacy" className="underline hover:text-neutral-900">
          数据处理告知
        </Link>
      </footer>
    </div>
  )
}
