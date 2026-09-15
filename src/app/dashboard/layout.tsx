import type { ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAuthContext } from '@/auth/context'
import LogoutButton from './logout-button'

// UX-level guard ONLY. Real authorization is re-checked in every Server Action /
// Route Handler / data fetch via requireAuthContext() + requirePermission().
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')

  return (
    <div className="min-h-dvh">
      <header className="flex flex-col gap-3 border-b border-neutral-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-base font-semibold">课程排课系统</h1>
        <nav className="flex gap-4 text-sm">
          <Link href="/dashboard/schedule" className="text-neutral-700 hover:underline">
            排课
          </Link>
          <Link href="/dashboard/students" className="text-neutral-700 hover:underline">
            学生
          </Link>
          <Link href="/dashboard/courses" className="text-neutral-700 hover:underline">
            课程
          </Link>
          <Link href="/dashboard/reports" className="text-neutral-700 hover:underline">
            报告
          </Link>
          <Link href="/dashboard/reschedule" className="text-neutral-700 hover:underline">
            改期申请
          </Link>
          <Link href="/dashboard/calendar" className="text-neutral-700 hover:underline">
            日历订阅
          </Link>
          <LogoutButton />
        </nav>
      </header>
      <main className="p-6">{children}</main>
    </div>
  )
}
