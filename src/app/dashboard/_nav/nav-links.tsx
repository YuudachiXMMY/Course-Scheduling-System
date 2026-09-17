'use client'

import { type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import LogoutButton from '../logout-button'

// Top nav with active-state highlighting. Each accessible name stays unique — exactly one link per
// label (smoke.spec asserts name→href for each). 学生 was folded into 用户管理 (/dashboard/users): the
// old /dashboard/students route now 302-redirects there, and smoke.spec's nav row was updated to match.
// The consolidation is visual: 课程/报告 now fold into a 教务 cluster behind the 教务工作台 workspace as
// `muted` secondary destinations, signalling they're managed there. A hard 302 on /dashboard/courses
// stays deferred until the workspace grows a course/section CREATE surface (today it's read-only nav,
// so /dashboard/courses is still the only place to create). flex-wrap prevents narrow-screen overflow.
function NavLink({
  href,
  activePrefix,
  muted,
  children,
}: {
  href: string
  activePrefix?: string
  muted?: boolean
  children: ReactNode
}) {
  const pathname = usePathname()
  const active = activePrefix ? pathname.startsWith(activePrefix) : pathname === href
  const base = muted ? 'text-xs' : ''
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? `${base} font-medium text-neutral-900`
          : `${base} ${muted ? 'text-neutral-500' : 'text-neutral-700'} hover:text-neutral-900 hover:underline`
      }
    >
      {children}
    </Link>
  )
}

export default function NavLinks({ canManageUsers }: { canManageUsers: boolean }) {
  return (
    <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <NavLink href="/dashboard/schedule">排课</NavLink>
      {canManageUsers && (
        <NavLink href="/dashboard/users" activePrefix="/dashboard/users">
          用户管理
        </NavLink>
      )}
      <span className="flex items-center gap-2 rounded-full bg-neutral-100 px-3 py-1">
        <NavLink href="/dashboard/teach" activePrefix="/dashboard/teach">
          教务工作台
        </NavLink>
        <span aria-hidden className="text-neutral-300">
          ·
        </span>
        <NavLink href="/dashboard/courses" muted>
          课程
        </NavLink>
        <NavLink href="/dashboard/reports" muted>
          报告
        </NavLink>
      </span>
      <NavLink href="/dashboard/reschedule" activePrefix="/dashboard/reschedule">
        改期申请
      </NavLink>
      <NavLink href="/dashboard/calendar">日历订阅</NavLink>
      <LogoutButton />
    </nav>
  )
}
