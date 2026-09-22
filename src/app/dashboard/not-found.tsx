import Link from 'next/link'

// H9: requirePagePermission() calls notFound() for a principal who lacks a page's permission, landing
// here instead of throwing to the generic error.tsx (whose reset() would loop). Renders inside
// dashboard/layout.tsx so the shell/nav stays. The message is deliberately neutral — it also covers a
// genuine missing resource under /dashboard — and offers a stable, non-looping way back.
export default function DashboardNotFound() {
  return (
    <div className="rounded-lg border border-neutral-200 p-6 text-center shadow-sm">
      <p className="text-sm text-neutral-600">页面不存在，或你没有访问该页面的权限。</p>
      <Link
        href="/dashboard"
        className="mt-3 inline-block text-xs text-neutral-700 underline underline-offset-4 hover:text-neutral-900"
      >
        返回仪表盘
      </Link>
    </div>
  )
}
