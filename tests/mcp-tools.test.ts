import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { inArray, eq } from 'drizzle-orm'
import { db } from '@/db'
import {
  organization,
  member,
  user,
  course,
  classSection,
  lesson,
  student,
  shareLink,
  enrollment,
  note,
} from '@/db/schema'
import { forTenant } from '@/db/tenant'
import { can } from '@/auth/authorize'
import { AuthError, type AuthContext } from '@/auth/context'
import { mcpAuthContextFor, resolveMcpAuthContext } from '@/auth/mcp-context'
import { registerCourseSchedulingTools } from '@/mcp/register-tools'
import { scheduleLessonCore, rescheduleLessonCore } from '@/lib/schedule-core'
import { BusinessError } from '@/lib/errors'
import { issueConfirmation, consumeConfirmation, hashPayload } from '@/lib/mcp-confirm'
import { composeParentMessage } from '@/mcp/message'
import type { FeedLesson } from '@/lib/ical-feed'

// M-1 guard: invoke the REAL draft_parent_message handler while stubbing ONLY the env-coupled
// principal resolver. mcpAuthContextFor stays real (spread from the actual module) so its own
// integration tests below are unaffected.
vi.mock('@/auth/mcp-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/mcp-context')>()),
  resolveMcpAuthContext: vi.fn(),
}))

// Register the real MCP tools on a minimal fake server to capture their handlers for direct
// invocation (no live McpServer / HTTP transport needed).
type ToolResult = { content: { type: string; text: string }[]; isError?: boolean }
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>
const captureTools = (): Map<string, ToolHandler> => {
  const handlers = new Map<string, ToolHandler>()
  const fakeServer = {
    registerTool: (name: string, _spec: unknown, handler: unknown) => {
      handlers.set(name, handler as ToolHandler)
    },
  }
  registerCourseSchedulingTools(
    fakeServer as unknown as Parameters<typeof registerCourseSchedulingTools>[0],
  )
  return handlers
}

const ctxFor = (tenantId: string, userId: string, role = 'owner'): AuthContext => ({
  tenantId,
  userId,
  role,
  isPlatformAdmin: false,
})

// ---------------------------------------------------------------------------
// Pure: MCP tool RBAC (mirrors tests/rbac-scheduling.test.ts). Each tool's
// permission object is asserted against can() for representative roles.
// ---------------------------------------------------------------------------
describe('MCP tool RBAC (can)', () => {
  it('owner can schedule + reschedule', () => {
    expect(can('owner', { lesson: ['create'] })).toBe(true)
    expect(can('owner', { lesson: ['update'] })).toBe(true)
  })
  it('assistant can write lessons + read classes/students (list_classes/list_students/schedule)', () => {
    expect(can('assistant', { lesson: ['create'] })).toBe(true)
    expect(can('assistant', { lesson: ['update'] })).toBe(true)
    expect(can('assistant', { student: ['list'] })).toBe(true)
    expect(can('assistant', { course: ['read'] })).toBe(true)
  })
  it('parent cannot schedule; can read a student (draft_parent_message gate)', () => {
    expect(can('parent', { lesson: ['create'] })).toBe(false)
    expect(can('parent', { student: ['read'] })).toBe(true)
  })
  it('teacher passes draft_parent_message perms; student role does not', () => {
    expect(can('teacher', { student: ['read'], lesson: ['read'] })).toBe(true)
    expect(can('student', { student: ['read'] })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Pure: draft-and-confirm token gate (server-enforced, single-use, TTL,
// payload-hash bound). now is passed explicitly for determinism.
// ---------------------------------------------------------------------------
describe('mcp-confirm draft-and-confirm gate', () => {
  const payload = {
    sectionId: 's1',
    startAt: new Date('2026-03-02T08:00:00Z'),
    endAt: new Date('2026-03-02T09:00:00Z'),
  }
  it('accepts a matching, unexpired token', () => {
    const t = issueConfirmation(payload, 1000)
    expect(consumeConfirmation(t, payload, 2000)).toBe(true)
  })
  it('is single-use (second consume fails)', () => {
    const t = issueConfirmation(payload, 1000)
    expect(consumeConfirmation(t, payload, 2000)).toBe(true)
    expect(consumeConfirmation(t, payload, 2000)).toBe(false)
  })
  it('rejects a changed payload', () => {
    const t = issueConfirmation(payload, 1000)
    expect(consumeConfirmation(t, { ...payload, sectionId: 's2' }, 2000)).toBe(false)
  })
  it('rejects an expired token (> 5 min)', () => {
    const t = issueConfirmation(payload, 1000)
    expect(consumeConfirmation(t, payload, 1000 + 6 * 60_000)).toBe(false)
  })
  it('rejects an unknown token', () => {
    expect(consumeConfirmation('does-not-exist', payload, 2000)).toBe(false)
  })
  it('hashPayload is deterministic and value-sensitive', () => {
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ a: 1, b: 2 }))
    expect(hashPayload({ a: 1 })).not.toBe(hashPayload({ a: 2 }))
  })
})

// ---------------------------------------------------------------------------
// Pure: parent-message composer (America/Toronto formatting, share URL, empty).
// ---------------------------------------------------------------------------
describe('composeParentMessage', () => {
  const shareUrl = 'https://x.example/s/tok'
  const mk = (
    id: string,
    startH: number,
    endH: number,
    title: string | null,
    location: string | null,
  ): FeedLesson => ({
    id,
    title,
    startAt: new Date(Date.UTC(2026, 2, 2, startH)),
    endAt: new Date(Date.UTC(2026, 2, 2, endH)),
    location,
  })
  it('formats lessons in America/Toronto and includes the share URL', () => {
    const text = composeParentMessage({
      studentName: '小明',
      lessons: [mk('l1', 8, 9, '数学', '房间1')],
      shareUrl,
    })
    expect(text).toContain('小明 近期课表：')
    expect(text).toContain('03:00') // 08:00Z → 03:00 America/Toronto (EST, -5; Mar 2 is pre-DST)
    expect(text).toContain('04:00') // 09:00Z → 04:00
    expect(text).toContain('数学')
    expect(text).toContain('房间1')
    expect(text).toContain(shareUrl)
  })
  it('handles no upcoming lessons', () => {
    const text = composeParentMessage({ studentName: '小明', lessons: [], shareUrl })
    expect(text).toContain('近期暂无排课')
    expect(text).toContain(shareUrl)
  })
  it('omits the share line when no shareUrl is given (M-1: read-only, no minted link)', () => {
    const withLessons = composeParentMessage({
      studentName: '小明',
      lessons: [mk('l1', 8, 9, '数学', '房间1')],
    })
    expect(withLessons).toContain('数学')
    expect(withLessons).not.toContain('完整课表随时查看')
    const empty = composeParentMessage({ studentName: '小明', lessons: [] })
    expect(empty).toContain('近期暂无排课')
    expect(empty).not.toContain('完整课表随时查看')
  })
})

// ---------------------------------------------------------------------------
// DB integration (needs a live Postgres via DATABASE_URL — same requirement as
// the existing conflict/tenant-isolation suites). Mirrors conflict.test.ts's
// fixture lifecycle: seed org/user/member (createdAt required), create rows via
// forTenant, idempotent cleanup in beforeAll + afterAll, children before parents.
// ---------------------------------------------------------------------------
const org = 'org_mcp'
const userId = 'user_mcp'
const teacherId = userId
let sectionId: string
let studentId: string
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 2, 9, h, m)) // 2026-03-09

const cleanup = async () => {
  await db.delete(lesson).where(eq(lesson.tenantId, org))
  await db.delete(shareLink).where(eq(shareLink.tenantId, org))
  await db.delete(classSection).where(eq(classSection.tenantId, org))
  await db.delete(course).where(eq(course.tenantId, org))
  await db.delete(student).where(eq(student.tenantId, org))
  await db.delete(organization).where(inArray(organization.id, [org]))
  await db.delete(user).where(inArray(user.id, [userId]))
}

describe('MCP DB integration (schedule-core + mcpAuthContextFor)', () => {
  beforeAll(async () => {
    await cleanup()
    const now = new Date()
    await db.insert(organization).values([{ id: org, name: 'M', slug: 'm-mcp', createdAt: now }])
    await db.insert(user).values([{ id: userId, name: 'T', email: 'm@t.com', emailVerified: true }])
    await db
      .insert(member)
      .values([{ id: 'm_mcp', organizationId: org, userId, role: 'owner', createdAt: now }])
    const ctx = ctxFor(org, userId)
    const [c] = (await forTenant(ctx).insert(course, { title: '物理' })) as { id: string }[]
    const [s] = (await forTenant(ctx).insert(classSection, {
      courseId: c.id,
      teacherId,
      capacity: 1,
    })) as { id: string }[]
    sectionId = s.id
    const [st] = (await forTenant(ctx).insert(student, { name: '测试学生' })) as { id: string }[]
    studentId = st.id
  })
  afterAll(cleanup)

  it('mcpAuthContextFor builds an owner AuthContext from the live member row', async () => {
    const ctx = await mcpAuthContextFor(userId, org)
    expect(ctx).toEqual({ userId, tenantId: org, role: 'owner', isPlatformAdmin: false })
  })

  it('mcpAuthContextFor throws AuthError for a non-member', async () => {
    await expect(mcpAuthContextFor('ghost_user', org)).rejects.toBeInstanceOf(AuthError)
  })

  it('scheduleLessonCore schedules a free slot (ok:true)', async () => {
    const res = await scheduleLessonCore(ctxFor(org, userId), {
      sectionId,
      startAt: at(10),
      endAt: at(11),
    })
    expect(res.ok).toBe(true)
  })

  it('scheduleLessonCore returns CONFLICT + suggestions on overlap (writes nothing)', async () => {
    const res = await scheduleLessonCore(ctxFor(org, userId), {
      sectionId,
      startAt: at(10, 30),
      endAt: at(11, 30),
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toBe('CONFLICT')
      expect(res.suggestions.length).toBeGreaterThan(0)
    }
    // The 10:00 lesson is still the only scheduled row (the conflicting one was not inserted).
    const scheduled = (
      (await forTenant(ctxFor(org, userId)).select(lesson)) as (typeof lesson.$inferSelect)[]
    ).filter((r) => r.status === 'scheduled')
    expect(scheduled).toHaveLength(1)
  })

  it('rescheduleLessonCore moves a lesson onto an overlapping-with-itself slot (excludeLessonId)', async () => {
    const rows = (await forTenant(ctxFor(org, userId)).select(
      lesson,
    )) as (typeof lesson.$inferSelect)[]
    const target = rows.find((r) => r.status === 'scheduled')
    expect(target).toBeDefined()
    // Move 10:00–11:00 → 10:30–11:30: overlaps its OWN old range, so only excludeLessonId keeps it clean.
    const res = await rescheduleLessonCore(ctxFor(org, userId), {
      id: target!.id,
      startAt: at(10, 30),
      endAt: at(11, 30),
    })
    expect(res.ok).toBe(true)
  })

  // L-cwe209 REGRESSION GUARD: the *_confirm MCP tools delegate to schedule-core, and runTool only
  // surfaces BusinessError messages (everything else → generic '操作失败'). A curated core message like
  // '课节不存在' MUST therefore be a BusinessError, not a plain Error — else a legit confirm-step failure
  // (section/lesson deleted or ownership lost between preview and confirm) returns an unhelpful generic.
  it('rescheduleLessonCore throws a surfaceable BusinessError for a missing lesson', async () => {
    await expect(
      rescheduleLessonCore(ctxFor(org, userId), {
        id: 'nonexistent-lesson-id',
        startAt: at(10, 0),
        endAt: at(11, 0),
      }),
    ).rejects.toThrow(BusinessError)
    await expect(
      rescheduleLessonCore(ctxFor(org, userId), {
        id: 'nonexistent-lesson-id',
        startAt: at(10, 0),
        endAt: at(11, 0),
      }),
    ).rejects.toThrow('课节不存在')
  })

  // M-1 REGRESSION GUARD: the read-only draft_parent_message must NOT create a shareLink.
  // Reverting register-tools.ts from getActiveShare back to ensureActiveShare makes this fail.
  it('draft_parent_message is read-only: composes a draft without minting a shareLink', async () => {
    const ctx = ctxFor(org, userId)
    vi.mocked(resolveMcpAuthContext).mockResolvedValue(ctx)
    const draft = captureTools().get('draft_parent_message')
    expect(draft).toBeDefined()
    const res = await draft!({ studentId })
    expect(res.isError).toBeFalsy()
    const text = res.content[0]?.text ?? ''
    expect(text).toContain('近期课表') // '测试学生 近期课表：' header composed
    // Student has no active share → tutor-facing note appended, and NO public link emitted.
    expect(text).toContain('勿发送给家长')
    expect(text).not.toContain('/s/')
    // The crux of M-1: invoking the tool created ZERO shareLink rows.
    const shares = (await forTenant(ctx).select(
      shareLink,
      eq(shareLink.studentId, studentId),
    )) as (typeof shareLink.$inferSelect)[]
    expect(shares).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 工作流 E — MCP 工具行级作用域（Slice C / B52–B57）。独立 org（org_mcp_scope），避免与上面的
// 用例串扰（fileParallelism=false → 同文件串行）。核心不变量：section-scoped teacherB 绝不应看到
// teacherA 的班级/学生/课节笔记，也不能起草/预览他人数据；owner（whole-tenant）看得到全部。
// ---------------------------------------------------------------------------
const scopeOrg = 'org_mcp_scope'
const ownerU = 'u_owner_scope'
const teacherAU = 'u_ta_scope'
const teacherBU = 'u_tb_scope'
let secA: string
let secB: string
let stuA: string
let stuB: string
let lessonAId: string

const scopeCleanup = async () => {
  // children → parents; note/enrollment 虽随 lesson/section 级联，仍显式先删以保证幂等与清晰。
  await db.delete(note).where(eq(note.tenantId, scopeOrg))
  await db.delete(enrollment).where(eq(enrollment.tenantId, scopeOrg))
  await db.delete(lesson).where(eq(lesson.tenantId, scopeOrg))
  await db.delete(shareLink).where(eq(shareLink.tenantId, scopeOrg))
  await db.delete(classSection).where(eq(classSection.tenantId, scopeOrg))
  await db.delete(course).where(eq(course.tenantId, scopeOrg))
  await db.delete(student).where(eq(student.tenantId, scopeOrg))
  await db.delete(organization).where(inArray(organization.id, [scopeOrg]))
  await db.delete(user).where(inArray(user.id, [ownerU, teacherAU, teacherBU]))
}

describe('MCP tool row-level scope (工作流 E / B52–B57)', () => {
  const ownerCtx = () => ctxFor(scopeOrg, ownerU, 'owner')
  const teacherACtx = () => ctxFor(scopeOrg, teacherAU, 'teacher')
  const teacherBCtx = () => ctxFor(scopeOrg, teacherBU, 'teacher')

  // Drive a REAL tool handler under a chosen principal by stubbing only resolveMcpAuthContext.
  const invoke = async (tool: string, ctx: AuthContext, args: Record<string, unknown> = {}) => {
    vi.mocked(resolveMcpAuthContext).mockResolvedValue(ctx)
    const handler = captureTools().get(tool)
    expect(handler).toBeDefined()
    return handler!(args)
  }
  const parseOk = (res: ToolResult) => {
    expect(res.isError).toBeFalsy()
    return JSON.parse(res.content[0]?.text ?? '[]') as Array<Record<string, unknown>>
  }

  beforeAll(async () => {
    await scopeCleanup()
    const now = new Date()
    await db
      .insert(organization)
      .values([{ id: scopeOrg, name: 'S', slug: 's-mcp-scope', createdAt: now }])
    await db.insert(user).values([
      { id: ownerU, name: 'O', email: 'o@scope.com', emailVerified: true },
      { id: teacherAU, name: 'TA', email: 'ta@scope.com', emailVerified: true },
      { id: teacherBU, name: 'TB', email: 'tb@scope.com', emailVerified: true },
    ])
    await db.insert(member).values([
      { id: 'm_owner_scope', organizationId: scopeOrg, userId: ownerU, role: 'owner', createdAt: now },
      { id: 'm_ta_scope', organizationId: scopeOrg, userId: teacherAU, role: 'teacher', createdAt: now },
      { id: 'm_tb_scope', organizationId: scopeOrg, userId: teacherBU, role: 'teacher', createdAt: now },
    ])
    const admin = ownerCtx()
    const [c] = (await forTenant(admin).insert(course, { title: '数学' })) as { id: string }[]
    const [sa] = (await forTenant(admin).insert(classSection, {
      courseId: c.id,
      teacherId: teacherAU,
      name: 'A班',
      capacity: 5,
    })) as { id: string }[]
    const [sb] = (await forTenant(admin).insert(classSection, {
      courseId: c.id,
      teacherId: teacherBU,
      name: 'B班',
      capacity: 5,
    })) as { id: string }[]
    secA = sa.id
    secB = sb.id
    const [studentARow] = (await forTenant(admin).insert(student, {
      name: 'A同学',
    })) as { id: string }[]
    const [studentBRow] = (await forTenant(admin).insert(student, {
      name: 'B同学',
    })) as { id: string }[]
    stuA = studentARow.id
    stuB = studentBRow.id
    await forTenant(admin).insert(enrollment, { studentId: stuA, sectionId: secA, status: 'active' })
    await forTenant(admin).insert(enrollment, { studentId: stuB, sectionId: secB, status: 'active' })
    // teacherA 名下一节课（用 core 走真实排课路径），作为 get_lesson_notes / reschedule 的目标。
    const sched = await scheduleLessonCore(teacherACtx(), {
      sectionId: secA,
      startAt: at(13),
      endAt: at(14),
    })
    expect(sched.ok).toBe(true)
    if (sched.ok) lessonAId = sched.event.id
    // 该课两条笔记：一条 internal（仅内部可见），一条 shared（家长可见）。
    await forTenant(admin).insert(note, {
      lessonId: lessonAId,
      sectionId: secA,
      authorId: teacherAU,
      body: '内部笔记A',
      visibility: 'internal',
    })
    await forTenant(admin).insert(note, {
      lessonId: lessonAId,
      sectionId: secA,
      authorId: teacherAU,
      body: '家长可见A',
      visibility: 'shared',
    })
  })
  afterAll(scopeCleanup)

  // B55: list_classes 收敛到本班。
  it('list_classes: teacherB 只见本班、看不到 teacherA 的班级；owner 见全部', async () => {
    const bIds = parseOk(await invoke('list_classes', teacherBCtx())).map((r) => r.id)
    expect(bIds).toContain(secB)
    expect(bIds).not.toContain(secA)

    const aIds = parseOk(await invoke('list_classes', teacherACtx())).map((r) => r.id)
    expect(aIds).toContain(secA)
    expect(aIds).not.toContain(secB)

    const ownerIds = parseOk(await invoke('list_classes', ownerCtx())).map((r) => r.id)
    expect(ownerIds).toEqual(expect.arrayContaining([secA, secB]))
  })

  // B56: list_students 收敛到本班在册学生（含 parentWechat PII）。
  it('list_students: teacherB 只见本班学生、看不到 teacherA 的学生；owner 见全部', async () => {
    const bIds = parseOk(await invoke('list_students', teacherBCtx())).map((r) => r.id)
    expect(bIds).toContain(stuB)
    expect(bIds).not.toContain(stuA)

    const ownerIds = parseOk(await invoke('list_students', ownerCtx())).map((r) => r.id)
    expect(ownerIds).toEqual(expect.arrayContaining([stuA, stuB]))
  })

  // B53: get_lesson_notes 归属守卫 + internal 对非 whole-tenant 排除。
  it('get_lesson_notes: teacherB 得空；teacherA 得笔记但 internal 被排除；owner 得全部', async () => {
    const bNotes = parseOk(await invoke('get_lesson_notes', teacherBCtx(), { lessonId: lessonAId }))
    expect(bNotes).toHaveLength(0)

    const aBodies = parseOk(
      await invoke('get_lesson_notes', teacherACtx(), { lessonId: lessonAId }),
    ).map((n) => n.body)
    expect(aBodies).toContain('家长可见A')
    expect(aBodies).not.toContain('内部笔记A')

    const ownerBodies = parseOk(
      await invoke('get_lesson_notes', ownerCtx(), { lessonId: lessonAId }),
    ).map((n) => n.body)
    expect(ownerBodies).toEqual(expect.arrayContaining(['家长可见A', '内部笔记A']))
  })

  // B52: draft_parent_message 归属守卫（放在 getActiveShare 之前）。
  it('draft_parent_message: teacherB 起草 teacherA 的学生被拒；teacherA/owner 可起草本班学生', async () => {
    const denied = await invoke('draft_parent_message', teacherBCtx(), { studentId: stuA })
    expect(denied.isError).toBe(true)
    expect(denied.content[0]?.text ?? '').toContain('无权访问该学生')

    const allowedA = await invoke('draft_parent_message', teacherACtx(), { studentId: stuA })
    expect(allowedA.isError).toBeFalsy()
    expect(allowedA.content[0]?.text ?? '').toContain('近期')

    const allowedOwner = await invoke('draft_parent_message', ownerCtx(), { studentId: stuA })
    expect(allowedOwner.isError).toBeFalsy()
  })

  // B54: schedule/reschedule preview 归属守卫（非本班视同不存在，不签发 token/不泄露冲突）。
  it('schedule/reschedule preview: teacherB 对 teacherA 的班级/课节被拒（视同不存在）', async () => {
    const schedDenied = await invoke('schedule_lesson_preview', teacherBCtx(), {
      sectionId: secA,
      startAt: at(15),
      endAt: at(16),
    })
    expect(schedDenied.isError).toBe(true)
    expect(schedDenied.content[0]?.text ?? '').toContain('班级不存在')

    const reschedDenied = await invoke('reschedule_lesson_preview', teacherBCtx(), {
      id: lessonAId,
      startAt: at(16),
      endAt: at(17),
    })
    expect(reschedDenied.isError).toBe(true)
    expect(reschedDenied.content[0]?.text ?? '').toContain('课节不存在')
  })
})
