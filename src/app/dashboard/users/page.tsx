import type { ReactNode } from 'react'
import Link from 'next/link'
import { requireAuthContext } from '@/auth/context'
import { can, requirePermission } from '@/auth/authorize'
import StudentsTab from './students-tab'
import ParentsTab from './parents-tab'

function TabLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? 'rounded-full bg-neutral-900 px-3 py-1 text-white'
          : 'rounded-full px-3 py-1 text-neutral-600 hover:bg-neutral-100'
      }
    >
      {children}
    </Link>
  )
}

// 用户管理 — students + parents (portal accounts) under one page. Page-level gate is student:list so
// every staff role can view the 学生 tab; the 家长 tab (portal-account management) is owner/admin only,
// so it is both hidden and, on a direct ?tab=parents hit by a non-manager, collapsed back to students.
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { student: ['list'] })
  const canManageUsers = can(ctx.role, { member: ['create'] })
  const { tab: rawTab } = await searchParams // Next 16: searchParams is a Promise — must await
  const tab = rawTab === 'parents' && canManageUsers ? 'parents' : 'students'

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4">
        <h2 className="text-lg font-semibold">用户管理</h2>
        <nav className="flex gap-1 text-sm">
          <TabLink href="/dashboard/users?tab=students" active={tab === 'students'}>
            学生
          </TabLink>
          {canManageUsers && (
            <TabLink href="/dashboard/users?tab=parents" active={tab === 'parents'}>
              家长
            </TabLink>
          )}
        </nav>
      </div>
      {tab === 'students' ? <StudentsTab /> : <ParentsTab />}
    </section>
  )
}
