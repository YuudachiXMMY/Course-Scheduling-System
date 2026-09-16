'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

// Tabs are navigation (they change ?tab= and re-render an RSC subtree), so they're modelled as links
// with aria-current — not a role="tablist" whose panels aren't all in the DOM (only the active panel
// renders, under a keyed Suspense in page.tsx). Manual activation is inherent to links (focus, then
// Enter navigates), so arrow-key auto-navigation jank never arises.
const TABS = [
  { key: 'lessons', label: '排课' },
  { key: 'students', label: '学生' },
  { key: 'reports', label: '报告' },
  { key: 'export', label: '导出' },
  { key: 'settings', label: '设置' },
] as const

export default function TabBar({
  sectionId,
  canManage,
}: {
  sectionId: string
  canManage: boolean
}) {
  const sp = useSearchParams()
  const active = sp.get('tab') ?? 'lessons'
  // 设置 needs course:update; hide it for read-only roles (assistant) instead of showing a dead tab
  // that only yields a permission-denied message.
  const tabs = canManage ? TABS : TABS.filter((t) => t.key !== 'settings')

  return (
    <nav
      aria-label="班级操作"
      className="flex flex-wrap gap-4 border-b border-neutral-200 pb-2 text-sm"
    >
      {tabs.map((t) => {
        const isActive = t.key === active
        return (
          <Link
            key={t.key}
            href={`/dashboard/teach/${sectionId}?tab=${t.key}`}
            aria-current={isActive ? 'page' : undefined}
            className={
              isActive
                ? 'font-medium text-neutral-900 underline underline-offset-8'
                : 'text-neutral-600 hover:text-neutral-900'
            }
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
