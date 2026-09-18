import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { classSection, course } from '@/db/schema'
import { getSectionShareByToken, getSectionScheduleForShare } from '@/lib/share'
import { ScheduleCard } from '@/lib/schedule-card'
import { sectionDisplayName } from '@/lib/ical-feed'

// PUBLIC, NO-AUTH read-only page (P4-2), the section mirror of /s/[token]. Outside dashboard/ so no
// auth-guard layout wraps it: a bad/revoked token renders not-found.tsx, never a login redirect.
export const dynamic = 'force-dynamic'
// noindex belt-and-suspenders: metadata here + X-Robots-Tag header in next.config (P4-10).
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function SectionSharePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const share = await getSectionShareByToken(token)
  if (!share) notFound()

  // Public read exception (P4-2): the section lookup is scoped by the token-RESOLVED
  // share.tenantId + share.sectionId — NEVER a request param. Deliberate, confined public read
  // (mirrors src/lib/share.ts), not the forTenant() spine.
  const [sec] = await db
    .select({ name: classSection.name, courseTitle: course.title })
    .from(classSection)
    .innerJoin(
      course,
      and(eq(course.tenantId, classSection.tenantId), eq(course.id, classSection.courseId)),
    )
    .where(and(eq(classSection.tenantId, share.tenantId), eq(classSection.id, share.sectionId)))
    .limit(1)
  if (!sec) notFound()

  // ScheduleCard hardcodes "{studentName} 的课表" — pass the section's display name as the title.
  const displayName = sectionDisplayName(sec.courseTitle, sec.name)
  const lessons = await getSectionScheduleForShare(share.tenantId, share.sectionId)

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 16 }}>
      <ScheduleCard data={{ studentName: displayName, lessons }} />
      <footer style={{ marginTop: 24, fontSize: 12, color: '#737373' }}>
        本页仅供查看，链接可能随时更新。
        <Link href="/privacy" style={{ marginLeft: 4, textDecoration: 'underline' }}>
          数据处理告知
        </Link>
      </footer>
    </main>
  )
}
