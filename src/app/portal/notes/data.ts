import 'server-only'
import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { forTenant } from '@/db/tenant'
import { requireConsent, resolveLinkedStudentIds } from '@/auth/portal'
import { classSection, course, enrollment, lesson, note } from '@/db/schema'
import { sectionDisplayName } from '@/lib/ical-feed'
import { APP_TIME_ZONE } from '@/lib/timezone'
import type { AuthContext } from '@/auth/context'

// 门户「课节笔记」的可序列化行（Dates → ISO date 字符串，RSC → client 边界不外发 Date）。
export interface PortalLessonNote {
  id: string // note.id
  lessonId: string
  sectionLabel: string // "课程名 · 班级名"
  lessonDate: string // 课节日期（YYYY-MM-DD，按 APP_TIME_ZONE）
  body: string // Markdown + LaTeX 源文，客户端用 MarkdownView 渲染
}

// 门户课节笔记加载器（面向 UNTRUSTED 家长/学生）。安全不变量：
//   1) 行级 scope —— 只看本用户 portalLink 关联学生（resolveLinkedStudentIds：家长→其孩子，学生→本人）
//      在读（active enrollment）班级里的课节；用户从不传 studentId/sectionId 参数。
//   2) 仅共享笔记 —— studentId IS NULL（排除逐生点评，即便点评被标记 shared 也绝不外泄）。
//   3) 仅「对外开放」—— visibility = 'shared'（internal 草稿是教师内部可见）。
//   4) 同意门复检 —— requireConsent，独立于 layout 的 ConsentGate（后者仅 UX 级）。
export async function getPortalLessonNotes(ctx: AuthContext): Promise<PortalLessonNote[]> {
  await requireConsent(ctx)

  const studentIds = await resolveLinkedStudentIds(ctx)
  if (studentIds.length === 0) return [] // inArray([]) 是非法 SQL —— 提前返回

  // 关联学生的 active enrollment → 班级集合。
  const enrolls = await forTenant(ctx).select(
    enrollment,
    and(inArray(enrollment.studentId, studentIds), eq(enrollment.status, 'active')),
  )
  const sectionIds = [...new Set(enrolls.map((e) => e.sectionId))]
  if (sectionIds.length === 0) return []

  // 这些班级的非取消课节。
  const lessons = await forTenant(ctx).select(
    lesson,
    and(inArray(lesson.sectionId, sectionIds), ne(lesson.status, 'canceled')),
  )
  if (lessons.length === 0) return []
  const lessonById = new Map(lessons.map((l) => [l.id, l]))
  const lessonIds = lessons.map((l) => l.id)

  // 仅这些课节的「对外开放」共享笔记：studentId IS NULL 且 visibility='shared'。行级 scope 已由 lessonIds
  // 收敛（只源自关联班级），visibility/studentId 谓词推入 SQL。
  const noteRows = await forTenant(ctx).select(
    note,
    and(inArray(note.lessonId, lessonIds), isNull(note.studentId), eq(note.visibility, 'shared')),
  )
  if (noteRows.length === 0) return []

  // 解析班级 → "课程名 · 班级名"（forTenant 单表读，无 join；先取 section 再取 course，与门户报告一致）。
  const secs = await forTenant(ctx).select(classSection, inArray(classSection.id, sectionIds))
  const courseIds = [...new Set(secs.map((s) => s.courseId))]
  const courses =
    courseIds.length > 0 ? await forTenant(ctx).select(course, inArray(course.id, courseIds)) : []
  const titleOf = new Map(courses.map((c) => [c.id, c.title]))
  const labelBySection = new Map<string, string>()
  for (const s of secs)
    labelBySection.set(s.id, sectionDisplayName(titleOf.get(s.courseId) ?? '', s.name))

  const localDay = (d: Date) =>
    DateTime.fromJSDate(d, { zone: 'utc' }).setZone(APP_TIME_ZONE).toISODate()!
  const startOf = (n: (typeof noteRows)[number]) => lessonById.get(n.lessonId!)!.startAt.getTime()

  return noteRows
    .slice()
    .sort((a, b) => startOf(b) - startOf(a)) // 最近课节在前
    .map((n) => {
      const l = lessonById.get(n.lessonId!)!
      return {
        id: n.id,
        lessonId: n.lessonId!,
        sectionLabel: labelBySection.get(l.sectionId) ?? l.sectionId,
        lessonDate: localDay(l.startAt),
        body: n.body,
      }
    })
}
