import { requireAuthContext } from '@/auth/context'
import { can } from '@/auth/authorize'
import CourseForm from '@/app/dashboard/courses/course-form'
import SectionForm from '@/app/dashboard/courses/section-form'
import SectionTeachersPanel from '@/app/dashboard/courses/section-teachers-panel'
import { listSectionMeetings } from '@/app/dashboard/courses/actions'
import { listSectionTeachers } from '@/app/dashboard/courses/section-teacher-actions'
import { listAssignableTeachers } from '@/app/dashboard/courses/data'
import { getSectionHeader } from '../data'
import SectionDangerZone from '../section-danger-zone'
import { formatDateTime } from '@/lib/format-datetime'

const WEEKDAY_ZH: Record<string, string> = {
  MO: '周一',
  TU: '周二',
  WE: '周三',
  TH: '周四',
  FR: '周五',
  SA: '周六',
  SU: '周日',
}
const fmtDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—')

// 设置 tab. 多教师改造: teachers/assistants can now VIEW course & section settings (read-only) — the tab is
// no longer hidden for them. owner/admin (course:update) get the editable forms + the teacher/assistant
// manager + danger zone; a section-scoped teacher/assistant gets a read-only summary + a read-only teacher
// list. getSectionHeader() enforces section ownership either way (a foreign section id → notFound()).
export default async function SettingsPanel({ sectionId }: { sectionId: string }) {
  const ctx = await requireAuthContext()
  const canManage = can(ctx.role, { course: ['update'] })
  const { section, course } = await getSectionHeader(ctx, sectionId)
  const [teachers, candidates, meetings] = await Promise.all([
    listSectionTeachers(sectionId),
    canManage ? listAssignableTeachers(ctx) : Promise.resolve([]),
    canManage ? Promise.resolve([]) : listSectionMeetings(sectionId),
  ])

  if (canManage) {
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
            创建于 {formatDateTime(section.createdAt)} · 最近修改{' '}
            {formatDateTime(section.updatedAt)}
          </p>
          <SectionForm
            courseId={course.id}
            defaultTeacherId={ctx.userId}
            section={section}
            embedded
          />
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-neutral-700">教师 / 助教</h3>
          <p className="text-xs text-neutral-400">
            被添加的教师/助教才能访问本班级；「主讲」用于新课节的默认授课教师。
          </p>
          <SectionTeachersPanel
            sectionId={sectionId}
            teachers={teachers}
            candidates={candidates}
            canManage
          />
        </div>

        <SectionDangerZone sectionId={sectionId} />
      </div>
    )
  }

  // Read-only view for a section-scoped teacher/assistant: they may VIEW settings but not edit them.
  return (
    <div className="flex flex-col gap-6 text-sm">
      <p className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2 text-xs text-neutral-500">
        你可以查看课程与班级设置，但没有编辑权限。如需修改，请联系管理员。
      </p>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-neutral-700">课程设置</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-neutral-600">
          <dt className="text-neutral-400">课程名称</dt>
          <dd>{course.title}</dd>
          <dt className="text-neutral-400">科目 / 级别</dt>
          <dd>
            {course.subject ?? '—'} · {course.level ?? '—'}
          </dd>
          <dt className="text-neutral-400">默认时长</dt>
          <dd className="tabular-nums">{course.defaultDurationMinutes} 分钟</dd>
        </dl>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-neutral-700">班级设置</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-neutral-600">
          <dt className="text-neutral-400">班级名称</dt>
          <dd>{section.name ?? '（未命名班级）'}</dd>
          <dt className="text-neutral-400">容量</dt>
          <dd className="tabular-nums">{section.capacity} 人</dd>
          <dt className="text-neutral-400">学期</dt>
          <dd className="tabular-nums">
            {fmtDay(section.termStartDate)} 至 {fmtDay(section.termEndDate)}
          </dd>
          <dt className="text-neutral-400">上课地点</dt>
          <dd>{section.defaultLocation ?? '—'}</dd>
          <dt className="text-neutral-400">上课时段</dt>
          <dd className="tabular-nums">
            {meetings.length === 0
              ? '—'
              : meetings
                  .map(
                    (m) =>
                      `${WEEKDAY_ZH[m.byDay] ?? m.byDay} ${m.startTime}（${m.durationMinutes}分）`,
                  )
                  .join('、')}
          </dd>
        </dl>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-neutral-700">教师 / 助教</h3>
        <SectionTeachersPanel
          sectionId={sectionId}
          teachers={teachers}
          candidates={[]}
          canManage={false}
        />
      </div>
    </div>
  )
}
