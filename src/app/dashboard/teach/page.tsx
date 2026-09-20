import { redirect } from 'next/navigation'
import { requireAuthContext } from '@/auth/context'
import { requirePagePermission } from '@/auth/authorize'
import { listCourses, listSections } from '../courses/actions'

// Index: land on the first section of a non-archived course, else an empty-state CTA. The selection
// lives in the URL, so a bookmark/refresh of a specific section restores it verbatim (this route only
// runs when no section is chosen).
export default async function TeachIndexPage() {
  const ctx = await requireAuthContext()
  requirePagePermission(ctx, { course: ['list'] })
  const [courses, sections] = await Promise.all([listCourses(), listSections()])
  const archivedCourseIds = new Set(courses.filter((c) => c.isArchived).map((c) => c.id))
  const first = sections.find((s) => !archivedCourseIds.has(s.courseId))
  if (first) redirect(`/dashboard/teach/${first.id}?tab=lessons`)

  return (
    <section className="rounded-lg border border-dashed border-neutral-300 px-4 py-12 text-center">
      <h2 className="text-lg font-semibold">教务工作台</h2>
      <p className="mt-2 text-sm text-neutral-500">
        还没有班级。请在左侧先创建课程与班级，然后即可管理排课、学生、报告与导出。
      </p>
    </section>
  )
}
