import type { ReactNode } from 'react'
import { requireAuthContext } from '@/auth/context'
import { requirePermission, can } from '@/auth/authorize'
import { listCourses, listSections } from '../courses/actions'
import CourseTree from './course-tree'

// Workspace shell. The rail (Course→Section tree) lives here so it mounts ONCE and survives
// [sectionId] navigation (its client expand/focus state is preserved across section switches).
// Portal roles are already redirected to /portal by the parent DashboardLayout; this adds the
// course:list wall (parent/student hold no course perms) as defence-in-depth.
export default async function TeachLayout({ children }: { children: ReactNode }) {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { course: ['list'] })
  const [courses, sections] = await Promise.all([listCourses(), listSections()])
  const perms = {
    canCreate: can(ctx.role, { course: ['create'] }),
    canManage: can(ctx.role, { course: ['update'] }),
  }

  return (
    // flex-col on mobile stacks the rail (with all create/restore controls) above the main pane;
    // md:flex-row is the two-pane desktop layout.
    <div className="flex flex-col gap-6 md:flex-row">
      <aside className="md:w-64 md:shrink-0">
        <CourseTree
          courses={courses}
          sections={sections}
          perms={perms}
          defaultTeacherId={ctx.userId}
        />
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
