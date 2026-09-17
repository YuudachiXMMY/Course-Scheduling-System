import type { ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireAuthContext } from '@/auth/context'
import { can } from '@/auth/authorize'
import StudentsTab from './students-tab'
import ParentsTab from './parents-tab'
import TeachersTab from './teachers-tab'
import AdminsTab from './admins-tab'

function TabLink({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: ReactNode
}) {
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

const TABS = ['students', 'parents', 'teachers', 'admins'] as const
type Tab = (typeof TABS)[number]

// 用户管理 — four tabs (学生 / 家长 / 教师 / 管理员) under one page. The whole page is now owner/admin/super
// admin only: teacher/assistant are redirected out (decision 1 — they no longer get a global roster). The
// 管理员 tab shows admins to any manager but only lets a super admin write (gated inside AdminsTab). Every
// tab re-checks its own permission (defence in depth); this page gate is the UX-level fast bounce.
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const ctx = await requireAuthContext()
  // Manager gate: an org manager (owner/admin via member:create) OR the platform super admin. teacher /
  // assistant hold no member:create and are not platform admins → bounced to /dashboard.
  if (!(can(ctx.role, { member: ['create'] }) || ctx.isPlatformAdmin)) redirect('/dashboard')

  const { tab: rawTab } = await searchParams // Next 16: searchParams is a Promise — must await
  const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? '') ? (rawTab as Tab) : 'students'

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4">
        <h2 className="text-lg font-semibold">用户管理</h2>
        <nav className="flex gap-1 text-sm">
          <TabLink href="/dashboard/users?tab=students" active={tab === 'students'}>
            学生
          </TabLink>
          <TabLink href="/dashboard/users?tab=parents" active={tab === 'parents'}>
            家长
          </TabLink>
          <TabLink href="/dashboard/users?tab=teachers" active={tab === 'teachers'}>
            教师
          </TabLink>
          <TabLink href="/dashboard/users?tab=admins" active={tab === 'admins'}>
            管理员
          </TabLink>
        </nav>
      </div>
      {tab === 'students' && <StudentsTab />}
      {tab === 'parents' && <ParentsTab />}
      {tab === 'teachers' && <TeachersTab />}
      {tab === 'admins' && <AdminsTab />}
    </section>
  )
}
