import 'server-only'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { DateTime } from 'luxon'
import type { McpServer } from '@modelcontextprotocol/server'
import { forTenant } from '@/db/tenant'
import { classSection, course, student, note, lesson } from '@/db/schema'
import { requirePermission } from '@/auth/authorize'
import { AuthError } from '@/auth/context'
import { ConflictError } from '@/lib/errors'
import { resolveMcpAuthContext } from '@/auth/mcp-context'
import {
  createFields,
  createSchema,
  rescheduleFields,
  rescheduleSchema,
  scheduleLessonCore,
  rescheduleLessonCore,
} from '@/lib/schedule-core'
import { checkTeacherConflict } from '@/lib/conflict'
import { issueConfirmation, consumeConfirmation } from '@/lib/mcp-confirm'
import { composeParentMessage } from '@/mcp/message'
import { getActiveShare, getStudentLessonsForTenant } from '@/app/dashboard/students/share-data'
import { cardWindow } from '@/lib/ical-feed'
import { env } from '@/env'

const ZONE = 'Asia/Shanghai'
const fmtLocal = (d: Date) =>
  DateTime.fromJSDate(d, { zone: 'utc' }).setZone(ZONE).toFormat('MM月dd日 HH:mm')
const hhmm = (d: Date) => DateTime.fromJSDate(d, { zone: 'utc' }).setZone(ZONE).toFormat('HH:mm')

// MCP tool result helpers. Prefer returning isError content over throwing so the model gets a
// clean, structured message (Task 6 / mcp-handler guidance).
const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] })
const fail = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true })

// Central error → MCP-content mapping. Every tool body runs inside this so AuthError / ConflictError
// / ZodError / plain business-rule Errors surface as clean isError text, never a leaked stack.
async function runTool(fn: () => Promise<ReturnType<typeof ok> | ReturnType<typeof fail>>) {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof AuthError) {
      const msg =
        e.code === 'FORBIDDEN'
          ? '无权限执行该操作'
          : e.code === 'NO_ACTIVE_ORG'
            ? 'MCP 连接器未配置主体（请设置 MCP_ORG_ID / MCP_USER_ID）'
            : e.code === 'NOT_A_MEMBER'
              ? 'MCP 配置的用户不是该机构成员'
              : '认证失败'
      return fail(msg)
    }
    if (e instanceof ConflictError) return fail('时间冲突，无法保存')
    if (e instanceof z.ZodError)
      return fail(`参数校验失败：${e.issues.map((i) => i.message).join('；')}`)
    return fail(e instanceof Error ? e.message : '未知错误')
  }
}

// P6-4/5/6/7: every tool follows resolveMcpAuthContext → requirePermission → (parse) → forTenant/core.
// tenantId comes ONLY from the resolved principal; tool args never carry a tenant/org id.
export function registerCourseSchedulingTools(server: McpServer): void {
  // ---- READ: list_classes ----
  server.registerTool(
    'list_classes',
    {
      title: '列出班级',
      description: '列出本机构的班级（含所属课程名称）。',
      inputSchema: z.object({}),
    },
    async () =>
      runTool(async () => {
        const ctx = await resolveMcpAuthContext()
        requirePermission(ctx, { course: ['read'] })
        const sections = (await forTenant(ctx).select(
          classSection,
        )) as (typeof classSection.$inferSelect)[]
        const courses = (await forTenant(ctx).select(course)) as (typeof course.$inferSelect)[]
        const label = new Map(courses.map((c) => [c.id, c.title]))
        const out = sections.map((r) => ({
          id: r.id,
          name: r.name,
          course: label.get(r.courseId) ?? null,
          teacherId: r.teacherId,
          capacity: r.capacity,
          defaultLocation: r.defaultLocation,
        }))
        return ok(JSON.stringify(out, null, 2))
      }),
  )

  // ---- READ: list_students ----
  server.registerTool(
    'list_students',
    {
      title: '列出学生',
      description: '列出本机构的学生。可选按状态筛选。',
      inputSchema: z.object({ status: z.enum(['active', 'inactive', 'archived']).optional() }),
    },
    async ({ status }) =>
      runTool(async () => {
        const ctx = await resolveMcpAuthContext()
        requirePermission(ctx, { student: ['list'] })
        const rows = (await forTenant(
          ctx,
          // status is an optional filter; when absent the tenant scope alone applies.
        ).select(
          student,
          status ? eq(student.status, status) : undefined,
        )) as (typeof student.$inferSelect)[]
        const out = rows.map((s) => ({
          id: s.id,
          name: s.name,
          englishName: s.englishName,
          schoolGrade: s.schoolGrade,
          status: s.status,
          parentWechat: s.parentWechat,
        }))
        return ok(JSON.stringify(out, null, 2))
      }),
  )

  // ---- READ: get_lesson_notes ----
  server.registerTool(
    'get_lesson_notes',
    {
      title: '查看课节笔记',
      description: '获取某节课的笔记（含可见性）。',
      inputSchema: z.object({ lessonId: z.string().min(1) }),
    },
    async ({ lessonId }) =>
      runTool(async () => {
        const ctx = await resolveMcpAuthContext()
        requirePermission(ctx, { lesson: ['read'] })
        const rows = (await forTenant(ctx).select(
          note,
          and(eq(note.lessonId, lessonId)),
        )) as (typeof note.$inferSelect)[]
        const out = rows.map((n) => ({
          id: n.id,
          body: n.body,
          visibility: n.visibility, // 'internal' | 'shared' — caller decides; do NOT auto-forward internal notes to parents
          authorId: n.authorId,
          createdAt: n.createdAt,
        }))
        return ok(JSON.stringify(out, null, 2))
      }),
  )

  // ---- WRITE (draft): schedule_lesson_preview — dry-run, writes NOTHING ----
  server.registerTool(
    'schedule_lesson_preview',
    {
      title: '排课（预览）',
      description:
        '预览为某班级新增一节课：运行冲突检测，不写入数据库。返回 confirmationToken；用 schedule_lesson_confirm 传入相同参数以确认。',
      inputSchema: z.object(createFields),
    },
    async (rawArgs) =>
      runTool(async () => {
        const ctx = await resolveMcpAuthContext()
        requirePermission(ctx, { lesson: ['create'] })
        const args = createSchema.parse(rawArgs)
        const section = (await forTenant(ctx).findById(classSection, args.sectionId)) as
          typeof classSection.$inferSelect | null
        if (!section) throw new Error('班级不存在或不属于当前机构')
        if (!section.teacherId) throw new Error('班级尚未指定教师，无法排课')
        const check = await checkTeacherConflict(ctx, {
          teacherId: section.teacherId,
          startAt: args.startAt,
          endAt: args.endAt,
        })
        if (check.hasConflict) {
          const conflictNames = check.conflicts.map((c) => c.title ?? '课节').join('、')
          const alts = check.suggestions.map(hhmm).join(' / ') || '无'
          return fail(`时间冲突：与「${conflictNames}」重叠。可选时段：${alts}。请调整时间后重试。`)
        }
        const token = issueConfirmation(args)
        return ok(
          `可排课（无冲突）：${section.name ?? '班级'} ${fmtLocal(args.startAt)}–${hhmm(args.endAt)}。\n` +
            `确认请调用 schedule_lesson_confirm，confirmationToken="${token}"，并传入完全相同的参数。`,
        )
      }),
  )

  // ---- WRITE (execute): schedule_lesson_confirm ----
  server.registerTool(
    'schedule_lesson_confirm',
    {
      title: '排课（确认）',
      description:
        '执行已预览的排课。需要 schedule_lesson_preview 返回的 confirmationToken 与完全相同的参数。',
      inputSchema: z.object({ ...createFields, confirmationToken: z.string().min(1) }),
    },
    async ({ confirmationToken, ...rawArgs }) =>
      runTool(async () => {
        const ctx = await resolveMcpAuthContext()
        requirePermission(ctx, { lesson: ['create'] })
        const args = createSchema.parse(rawArgs)
        if (!consumeConfirmation(confirmationToken, args)) {
          throw new Error('确认令牌无效、已过期或参数已变化，请重新调用 schedule_lesson_preview。')
        }
        const result = await scheduleLessonCore(ctx, args)
        return result.ok
          ? ok(`已排课：${result.event.title} ${fmtLocal(new Date(result.event.start))}`)
          : fail(`时间冲突：可选时段 ${result.suggestions.join(' / ') || '无'}`)
      }),
  )

  // ---- WRITE (draft): reschedule_lesson_preview — dry-run, writes NOTHING ----
  server.registerTool(
    'reschedule_lesson_preview',
    {
      title: '改期（预览）',
      description:
        '预览把某节课移动到新时间：运行冲突检测，不写入。返回 confirmationToken；用 reschedule_lesson_confirm 传入相同参数以确认。',
      inputSchema: z.object(rescheduleFields),
    },
    async (rawArgs) =>
      runTool(async () => {
        const ctx = await resolveMcpAuthContext()
        requirePermission(ctx, { lesson: ['update'] })
        const args = rescheduleSchema.parse(rawArgs)
        const existing = (await forTenant(ctx).findById(lesson, args.id)) as
          typeof lesson.$inferSelect | null
        if (!existing) throw new Error('课节不存在')
        if (!existing.teacherId) throw new Error('课节缺少教师信息')
        const check = await checkTeacherConflict(ctx, {
          teacherId: existing.teacherId,
          startAt: args.startAt,
          endAt: args.endAt,
          excludeLessonId: args.id,
        })
        if (check.hasConflict) {
          const conflictNames = check.conflicts.map((c) => c.title ?? '课节').join('、')
          const alts = check.suggestions.map(hhmm).join(' / ') || '无'
          return fail(`时间冲突：与「${conflictNames}」重叠。可选时段：${alts}。请调整时间后重试。`)
        }
        const token = issueConfirmation(args)
        return ok(
          `可改期（无冲突）至 ${fmtLocal(args.startAt)}–${hhmm(args.endAt)}。\n` +
            `确认请调用 reschedule_lesson_confirm，confirmationToken="${token}"，并传入完全相同的参数。`,
        )
      }),
  )

  // ---- WRITE (execute): reschedule_lesson_confirm ----
  server.registerTool(
    'reschedule_lesson_confirm',
    {
      title: '改期（确认）',
      description:
        '执行已预览的改期。需要 reschedule_lesson_preview 返回的 confirmationToken 与完全相同的参数。',
      inputSchema: z.object({ ...rescheduleFields, confirmationToken: z.string().min(1) }),
    },
    async ({ confirmationToken, ...rawArgs }) =>
      runTool(async () => {
        const ctx = await resolveMcpAuthContext()
        requirePermission(ctx, { lesson: ['update'] })
        const args = rescheduleSchema.parse(rawArgs)
        if (!consumeConfirmation(confirmationToken, args)) {
          throw new Error(
            '确认令牌无效、已过期或参数已变化，请重新调用 reschedule_lesson_preview。',
          )
        }
        const result = await rescheduleLessonCore(ctx, args)
        return result.ok
          ? ok(`已改期：${result.event.title} ${fmtLocal(new Date(result.event.start))}`)
          : fail(`时间冲突：可选时段 ${result.suggestions.join(' / ') || '无'}`)
      }),
  )

  // ---- draft_parent_message — READ-ONLY: composes from EXISTING share-data, writes NOTHING ----
  // M-1 (PR#7 review): this tool must not mint a public share URL as a side effect. It attaches the
  // student's ALREADY-ACTIVE link if one exists and never creates one. Creating a share stays a
  // human-initiated action on the web 学生 page (getOrCreateShare) — the sanctioned, UI-confirmed
  // path. Gate stays read-tier {student:['read'], lesson:['read']}, consistent with P4-9 and the
  // authenticated PNG export route; it is now honest because the tool no longer writes.
  server.registerTool(
    'draft_parent_message',
    {
      title: '起草家长消息',
      description:
        '为某学生起草一条微信课表消息，附上其【已有】的只读分享链接（若尚未创建则不附链接，且本工具不会创建）。只读：只返回草稿文本，不发送、不写库。',
      inputSchema: z.object({ studentId: z.string().min(1) }),
    },
    async ({ studentId }) =>
      runTool(async () => {
        const ctx = await resolveMcpAuthContext()
        requirePermission(ctx, { student: ['read'], lesson: ['read'] })
        const s = (await forTenant(ctx).findById(student, studentId)) as
          typeof student.$inferSelect | null
        if (!s) throw new Error('学生不存在')
        // getActiveShare (read-only) — NOT ensureActiveShare. shareUrl is null when no active share.
        const share = await getActiveShare(ctx, studentId)
        const shareUrl = share ? `${env.NEXT_PUBLIC_APP_URL}/s/${share.token}` : null
        const lessons = await getStudentLessonsForTenant(ctx, studentId, cardWindow())
        const message = composeParentMessage({ studentName: s.name, lessons, shareUrl })
        // No share → append a clearly-fenced TUTOR-facing note AFTER the draft, explicitly labeled
        // 勿发送 so it is unmistakably NOT part of the copyable parent message (PR#7 verify nit).
        return ok(
          shareUrl
            ? message
            : `${message}\n\n——\n[提示 · 勿发送给家长] 该学生暂无有效分享链接，本草稿未附课表链接；如需附上，请在「学生」页面创建分享后重试。`,
        )
      }),
  )
}
