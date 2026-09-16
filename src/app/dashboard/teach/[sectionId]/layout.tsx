import type { ReactNode } from 'react'
import { requireAuthContext } from '@/auth/context'
import { getSectionHeader } from './data'
import TabBar from './tab-bar'

// Per-section header + tab bar. getSectionHeader() → notFound() for a stale/cross-tenant id; a real
// failure here bubbles to teach/error.tsx (rail preserved). This layout mounts per [sectionId], so a
// section switch shows [sectionId]/loading.tsx over the main pane while the header/tabs re-fetch.
export default async function SectionLayout({
  params,
  children,
}: {
  params: Promise<{ sectionId: string }>
  children: ReactNode
}) {
  const { sectionId } = await params
  const ctx = await requireAuthContext()
  const { section, course } = await getSectionHeader(ctx, sectionId)

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <h2 className="text-lg font-semibold">{course.title}</h2>
        <p className="text-sm text-neutral-500 tabular-nums">
          {section.name ?? '（未命名班级）'} · 容量 {section.capacity} 人
        </p>
      </header>
      <TabBar sectionId={sectionId} />
      {children}
    </section>
  )
}
