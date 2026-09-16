import Link from 'next/link'

// notFound() from getSectionHeader (stale / cross-tenant [sectionId]) lands here; it renders inside
// teach/layout.tsx so the rail stays and only the main pane shows the message.
export default function TeachNotFound() {
  return (
    <div className="rounded-lg border border-neutral-200 p-6 text-center shadow-sm">
      <p className="text-sm text-neutral-600">未找到该班级，可能已被删除或不属于当前机构。</p>
      <Link
        href="/dashboard/teach"
        className="mt-3 inline-block text-xs text-neutral-700 underline underline-offset-4 hover:text-neutral-900"
      >
        返回教务工作台
      </Link>
    </div>
  )
}
