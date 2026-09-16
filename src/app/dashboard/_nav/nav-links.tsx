'use client'

import { type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import LogoutButton from '../logout-button'

// Top nav with active-state highlighting. v1 is ADDITIVE: every legacy link is kept (so smoke.spec's
// name→href assertions stay green) and 教务工作台 is added. A later phase folds 课程/报告 into the
// workspace and trims them here in lockstep with the spec. flex-wrap keeps it from overflowing narrow
// screens.
function NavLink({
  href,
  activePrefix,
  children,
}: {
  href: string
  activePrefix?: string
  children: ReactNode
}) {
  const pathname = usePathname()
  const active = activePrefix ? pathname.startsWith(activePrefix) : pathname === href
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? 'font-medium text-neutral-900'
          : 'text-neutral-700 hover:text-neutral-900 hover:underline'
      }
    >
      {children}
    </Link>
  )
}

export default function NavLinks() {
  return (
    <nav className="flex flex-wrap items-center gap-4 text-sm">
      <NavLink href="/dashboard/schedule">排课</NavLink>
      <NavLink href="/dashboard/students">学生</NavLink>
      <NavLink href="/dashboard/teach" activePrefix="/dashboard/teach">
        教务工作台
      </NavLink>
      <NavLink href="/dashboard/courses">课程</NavLink>
      <NavLink href="/dashboard/reports">报告</NavLink>
      <NavLink href="/dashboard/reschedule" activePrefix="/dashboard/reschedule">
        改期申请
      </NavLink>
      <NavLink href="/dashboard/calendar">日历订阅</NavLink>
      <LogoutButton />
    </nav>
  )
}
