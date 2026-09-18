import Link from 'next/link'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { isWholeTenantActor } from '@/auth/scope'
import { listCourses, listSections } from './actions'
import { listTeachers } from './data'
import { listStudents } from '../students/actions'
import CourseForm from './course-form'
import SectionForm from './section-form'
import SectionRoster from './section-roster'
import CourseRestore from './course-restore'

export default async function CoursesPage() {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { course: ['list'] })
  // CR2: only whole-tenant admins get the teacher picker; fetch the assignable list only for them.
  const canAssignTeacher = isWholeTenantActor(ctx)
  const [courses, sections, students, teachers] = await Promise.all([
    listCourses(),
    listSections(),
    listStudents(),
    canAssignTeacher ? listTeachers(ctx) : Promise.resolve([]),
  ])
  const activeCourses = courses.filter((c) => !c.isArchived)
  const archivedCourses = courses.filter((c) => c.isArchived)
  const studentOptions = students
    .filter((s) => s.status !== 'archived')
    .map((s) => ({ id: s.id, name: s.name }))

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">课程</h2>
      <Link
        href="/dashboard/teach"
        className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600 hover:bg-neutral-100"
      >
        <span>课程与报告已统一到「教务工作台」——在班级内直接管理学生、排课、报告与导出。</span>
        <span className="shrink-0 font-medium text-neutral-900">前往教务工作台 →</span>
      </Link>
      <CourseForm />
      <div className="flex flex-col gap-4">
        {activeCourses.length === 0 && (
          <p className="text-sm text-neutral-500">暂无课程，先创建一个课程模板。</p>
        )}
        {activeCourses.map((c) => {
          const courseSections = sections.filter((s) => s.courseId === c.id)
          return (
            <div key={c.id} className="rounded-lg border border-neutral-200 p-4 shadow-sm">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">{c.title}</h3>
                  <p className="text-xs text-neutral-500">
                    {c.subject ?? '—'} · {c.level ?? '—'} · 默认 {c.defaultDurationMinutes} 分钟
                  </p>
                </div>
                <CourseForm course={c} />
              </div>
              <ul className="mb-3 flex flex-col gap-2">
                {courseSections.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-col gap-1 rounded border border-neutral-100 p-2 text-xs text-neutral-600 tabular-nums"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {s.name ?? '（未命名班级）'} · {s.rrule ?? '无重复'} · {s.capacity} 人
                      </span>
                      <div className="flex shrink-0 items-center gap-2">
                        <SectionForm
                          courseId={c.id}
                          defaultTeacherId={ctx.userId}
                          section={s}
                          teachers={teachers}
                          canAssignTeacher={canAssignTeacher}
                        />
                        <SectionRoster
                          sectionId={s.id}
                          capacity={s.capacity}
                          students={studentOptions}
                        />
                        <a
                          href={`/api/export/section/${s.id}`}
                          className="shrink-0 rounded border border-neutral-300 px-2 py-1 text-neutral-700 hover:bg-neutral-50"
                        >
                          批量导出(ZIP)
                        </a>
                      </div>
                    </div>
                  </li>
                ))}
                {courseSections.length === 0 && (
                  <li className="text-xs text-neutral-400">暂无班级</li>
                )}
              </ul>
              <SectionForm
                courseId={c.id}
                defaultTeacherId={ctx.userId}
                teachers={teachers}
                canAssignTeacher={canAssignTeacher}
              />
            </div>
          )
        })}
      </div>

      {archivedCourses.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-neutral-700 tabular-nums">
            已归档（{archivedCourses.length}）
          </h3>
          <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
            {archivedCourses.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between px-4 py-3 text-sm text-neutral-500"
              >
                <span>
                  {c.title}
                  <span className="ml-2 text-xs text-neutral-400">
                    {c.subject ?? '—'} · {c.level ?? '—'}
                  </span>
                </span>
                <CourseRestore courseId={c.id} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
