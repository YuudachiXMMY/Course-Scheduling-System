import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { getAuthContext } from '@/auth/context'

// UX-level guard ONLY. Real authorization is re-checked in every Server Action /
// Route Handler / data fetch via requireAuthContext() + requirePermission().
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')

  return (
    <div className="min-h-dvh">
      <header className="border-b border-neutral-200 px-6 py-4">
        <h1 className="text-base font-semibold">课程排课系统</h1>
      </header>
      <main className="p-6">{children}</main>
    </div>
  )
}
