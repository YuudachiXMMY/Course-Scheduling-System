import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { student } from '@/db/schema'
import { getShareByToken, getStudentScheduleForShare } from '@/lib/share'
import { ScheduleCard } from '@/lib/schedule-card'

// PUBLIC, NO-AUTH read-only page (P4-2). Outside dashboard/ so no auth-guard layout
// wraps it: a bad/revoked token renders not-found.tsx, never a login redirect.
export const dynamic = 'force-dynamic'
// noindex belt-and-suspenders: metadata here + X-Robots-Tag header in next.config (P4-10).
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const share = await getShareByToken(token)
  if (!share) notFound()

  // Public read exception (P4-2): the student lookup is scoped by the token-RESOLVED
  // share.tenantId + share.studentId — NEVER a request param. This is a deliberate,
  // confined public read (mirrors src/lib/share.ts), not the forTenant() spine.
  const [s] = await db
    .select()
    .from(student)
    .where(and(eq(student.tenantId, share.tenantId), eq(student.id, share.studentId)))
    .limit(1)
  if (!s) notFound()

  const lessons = await getStudentScheduleForShare(share.tenantId, share.studentId)

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 16 }}>
      <ScheduleCard
        data={{ studentName: s.name, subtitle: s.schoolGrade ?? undefined, lessons }}
      />
      <footer style={{ marginTop: 24, fontSize: 12, color: '#737373' }}>
        本页仅供查看，链接可能随时更新。
        <Link href="/privacy" style={{ marginLeft: 4, textDecoration: 'underline' }}>
          数据处理告知
        </Link>
      </footer>
    </main>
  )
}
