import { requireAuthContext } from '@/auth/context'
import { can } from '@/auth/authorize'
import CourseForm from '@/app/dashboard/courses/course-form'
import SectionForm from '@/app/dashboard/courses/section-form'
import { getSectionHeader } from '../data'
import SectionDangerZone from '../section-danger-zone'
import { formatDateTime } from '@/lib/format-datetime'

// 设置 tab: reuse CourseForm (expanded) + SectionForm (embedded) + a danger zone. Gated on course:update
// (assistant can't manage), so the whole tab is hidden for read-only roles.
export default async function SettingsPanel({ sectionId }: { sectionId: string }) {
  const ctx = await requireAuthContext()
  if (!can(ctx.role, { course: ['update'] })) {
    return <p className="text-sm text-neutral-500">你没有编辑课程与班级的权限。</p>
  }
  const { section, course } = await getSectionHeader(ctx, sectionId)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-neutral-700">课程设置</h3>
        <p className="text-xs text-neutral-400">编辑课程会影响该课程下的所有班级。</p>
        <CourseForm course={course} alwaysOpen />
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-neutral-700">班级设置</h3>
        <p className="text-xs text-neutral-400">
          创建于 {formatDateTime(section.createdAt)} · 最近修改 {formatDateTime(section.updatedAt)}
        </p>
        <SectionForm
          courseId={course.id}
          defaultTeacherId={ctx.userId}
          section={section}
          embedded
        />
      </div>

      <SectionDangerZone sectionId={sectionId} />
    </div>
  )
}
