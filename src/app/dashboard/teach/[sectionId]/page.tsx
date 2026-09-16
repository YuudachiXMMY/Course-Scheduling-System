import { Suspense, type ReactNode } from 'react'
import LessonsPanel from './tabs/lessons-panel'
import StudentsPanel from './tabs/students-panel'
import ReportsPanel from './tabs/reports-panel'
import ExportPanel from './tabs/export-panel'
import SettingsPanel from './tabs/settings-panel'

function TabSkeleton() {
  return <div className="h-40 animate-pulse rounded-lg bg-neutral-100" aria-hidden />
}

const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '')

// Tab body. Each panel awaits its OWN data (never hoisted here) so the keyed <Suspense> shows a real
// skeleton when tab/report-filter changes — the segment is unchanged, so [sectionId]/loading.tsx does
// not fire; the changing key remounts the boundary instead. The route is always dynamic (auth), which
// also disarms the useSearchParams() static-prerender bailout in the client children.
export default async function SectionTabPage({
  params,
  searchParams,
}: {
  params: Promise<{ sectionId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { sectionId } = await params
  const sp = await searchParams
  const tab = str(sp.tab) || 'lessons'
  // sectionId is part of the key so switching sections (rail links always go to ?tab=lessons, an
  // unchanged searchParam key) remounts the panel — otherwise the client SectionLessons instance is
  // reused and its openId/editId leak the previous section's lesson into the new one.
  const key = [sectionId, tab, str(sp.student), str(sp.period), str(sp.from), str(sp.to)].join('|')

  let panel: ReactNode
  switch (tab) {
    case 'students':
      panel = <StudentsPanel sectionId={sectionId} />
      break
    case 'reports':
      panel = <ReportsPanel sectionId={sectionId} searchParams={sp} />
      break
    case 'export':
      panel = <ExportPanel sectionId={sectionId} />
      break
    case 'settings':
      panel = <SettingsPanel sectionId={sectionId} />
      break
    default:
      panel = <LessonsPanel sectionId={sectionId} />
  }

  return (
    <Suspense key={key} fallback={<TabSkeleton />}>
      {panel}
    </Suspense>
  )
}
