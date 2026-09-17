import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { getAuthContext } from '@/auth/context'
import { can } from '@/auth/authorize'
import { isPortalRole } from '@/auth/portal'
import { unreadCountForUserCore } from '@/lib/notification-core'
import NavLinks from './_nav/nav-links'

// UX-level guard ONLY. Real authorization is re-checked in every Server Action /
// Route Handler / data fetch via requireAuthContext() + requirePermission().
// Role gate: parent/student belong in /portal, never the staff dashboard. Without this, a portal
// user could reach any /dashboard/* route whose permission verb they happen to hold — e.g.
// /dashboard/reschedule, gated on rescheduleRequest:['list'] which parent/student also carry for
// their OWN /portal/reschedule view, exposing the tenant-wide request queue. Mirrors PortalLayout's
// symmetric `if (!isPortalRole) redirect('/dashboard')`.
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (isPortalRole(ctx.role)) redirect('/portal')

  // Only managers (owner/admin) or the platform super admin get the 用户管理 nav item — teacher/assistant
  // are redirected out of /dashboard/users, so showing them the link would be a dead end. NavLinks is a
  // Client Component with no ctx, so the decision is computed here and passed as a serializable prop.
  const canManageUsers = can(ctx.role, { member: ['create'] }) || ctx.isPlatformAdmin
  // Unread badge for the 通知 nav item. Cheap at single-tutor scale; recomputed each render and
  // refreshed by revalidatePath('/dashboard/notifications') after a mark-read.
  const unreadCount = await unreadCountForUserCore(ctx)

  return (
    <div className="min-h-dvh">
      <header className="flex flex-col gap-3 border-b border-neutral-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-base font-semibold">课程排课系统</h1>
        <NavLinks canManageUsers={canManageUsers} unreadCount={unreadCount} />
      </header>
      <main className="p-6">{children}</main>
    </div>
  )
}
