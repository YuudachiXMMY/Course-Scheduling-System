'use client'

import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import CourseForm from '../courses/course-form'
import SectionForm from '../courses/section-form'
import CourseRestore from '../courses/course-restore'
import type { Course, ClassSection } from '../courses/actions'

// Left rail: Course → Section navigation. Modelled as <nav> + nested lists with aria-current (NOT
// role="tree") — it IS link navigation, so this gives correct SR semantics and lets the create/restore
// controls sit as ordinary focusable siblings without breaking a tree's single-tabstop model. On
// mobile the parent layout stacks this above the main pane, so every control stays reachable.
export default function CourseTree({
  courses,
  sections,
  perms,
  defaultTeacherId,
}: {
  courses: Course[]
  sections: ClassSection[]
  perms: { canCreate: boolean; canManage: boolean }
  defaultTeacherId: string
}) {
  const pathname = usePathname()
  const router = useRouter()
  const activeId = pathname.split('/')[3] // /dashboard/teach/<sectionId>

  const activeCourses = courses.filter((c) => !c.isArchived)
  const archivedCourses = courses.filter((c) => c.isArchived)
  const sectionsByCourse = new Map<string, ClassSection[]>()
  for (const s of sections) {
    const arr = sectionsByCourse.get(s.courseId) ?? []
    arr.push(s)
    sectionsByCourse.set(s.courseId, arr)
  }

  return (
    <nav aria-label="课程与班级" className="flex flex-col gap-3 md:sticky md:top-4">
      {perms.canCreate && (
        <details className="rounded-lg border border-neutral-200 shadow-sm">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50">
            ＋ 新建课程
          </summary>
          <div className="border-t border-neutral-200 p-3">
            <CourseForm alwaysOpen />
          </div>
        </details>
      )}

      {activeCourses.length === 0 && <p className="px-1 text-xs text-neutral-400">暂无课程</p>}

      <ul className="flex flex-col gap-3">
        {activeCourses.map((c) => {
          const courseSections = sectionsByCourse.get(c.id) ?? []
          return (
            <li key={c.id} className="flex flex-col gap-1">
              <div className="px-1 text-xs font-semibold tracking-wide text-neutral-500">
                {c.title}
              </div>
              <ul className="flex flex-col gap-0.5">
                {courseSections.map((s) => {
                  const active = s.id === activeId
                  return (
                    <li key={s.id}>
                      <Link
                        href={`/dashboard/teach/${s.id}?tab=lessons`}
                        aria-current={active ? 'page' : undefined}
                        className={`block rounded px-2 py-1 text-sm tabular-nums ${
                          active
                            ? 'bg-neutral-900 text-white'
                            : 'text-neutral-700 hover:bg-neutral-100'
                        }`}
                      >
                        {s.name ?? '（未命名班级）'}
                      </Link>
                    </li>
                  )
                })}
                {courseSections.length === 0 && (
                  <li className="px-2 text-xs text-neutral-400">暂无班级</li>
                )}
              </ul>
              {perms.canCreate && (
                <div className="px-1">
                  <SectionForm
                    courseId={c.id}
                    defaultTeacherId={defaultTeacherId}
                    onCreated={(id) => router.push(`/dashboard/teach/${id}?tab=lessons`)}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {perms.canManage && archivedCourses.length > 0 && (
        <details className="rounded-lg border border-neutral-200">
          <summary className="cursor-pointer px-3 py-2 text-xs text-neutral-500 hover:bg-neutral-50">
            已归档课程（{archivedCourses.length}）
          </summary>
          <ul className="divide-y divide-neutral-200 border-t border-neutral-200">
            {archivedCourses.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-neutral-500"
              >
                <span className="truncate">{c.title}</span>
                <CourseRestore courseId={c.id} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </nav>
  )
}
