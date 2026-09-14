import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { listCourses, listSections } from './actions'
import CourseForm from './course-form'
import SectionForm from './section-form'

export default async function CoursesPage() {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { course: ['list'] })
  const [courses, sections] = await Promise.all([listCourses(), listSections()])
  const activeCourses = courses.filter((c) => !c.isArchived)

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">课程</h2>
      <CourseForm />
      <div className="flex flex-col gap-4">
        {activeCourses.length === 0 && (
          <p className="text-sm text-neutral-500">暂无课程，先创建一个课程模板。</p>
        )}
        {activeCourses.map((c) => {
          const courseSections = sections.filter((s) => s.courseId === c.id)
          return (
            <div key={c.id} className="rounded border border-neutral-200 p-4">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">{c.title}</h3>
                  <p className="text-xs text-neutral-500">
                    {c.subject ?? '—'} · {c.level ?? '—'} · 默认 {c.defaultDurationMinutes} 分钟
                  </p>
                </div>
              </div>
              <ul className="mb-3 flex flex-col gap-1">
                {courseSections.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-2 text-xs text-neutral-600"
                  >
                    <span>
                      {s.name ?? '（未命名班级）'} · {s.rrule ?? '无重复'} · {s.capacity} 人
                    </span>
                    <a
                      href={`/api/export/section/${s.id}`}
                      className="shrink-0 rounded border border-neutral-300 px-2 py-1 text-neutral-700"
                    >
                      批量导出(ZIP)
                    </a>
                  </li>
                ))}
                {courseSections.length === 0 && (
                  <li className="text-xs text-neutral-400">暂无班级</li>
                )}
              </ul>
              <SectionForm courseId={c.id} defaultTeacherId={ctx.userId} />
            </div>
          )
        })}
      </div>
    </section>
  )
}
