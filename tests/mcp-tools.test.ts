import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { inArray, eq } from 'drizzle-orm'
import { db } from '@/db'
import { organization, member, user, course, classSection, lesson } from '@/db/schema'
import { forTenant } from '@/db/tenant'
import { can } from '@/auth/authorize'
import { AuthError, type AuthContext } from '@/auth/context'
import { mcpAuthContextFor } from '@/auth/mcp-context'
import { scheduleLessonCore, rescheduleLessonCore } from '@/lib/schedule-core'
import { issueConfirmation, consumeConfirmation, hashPayload } from '@/lib/mcp-confirm'
import { composeParentMessage } from '@/mcp/message'
import type { FeedLesson } from '@/lib/ical-feed'

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
// Pure: parent-message composer (Asia/Shanghai formatting, share URL, empty).
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
  it('formats lessons in Asia/Shanghai and includes the share URL', () => {
    const text = composeParentMessage({
      studentName: '小明',
      lessons: [mk('l1', 8, 9, '数学', '房间1')],
      shareUrl,
    })
    expect(text).toContain('小明 近期课表：')
    expect(text).toContain('16:00') // 08:00Z → 16:00 Asia/Shanghai (+8)
    expect(text).toContain('17:00') // 09:00Z → 17:00
    expect(text).toContain('数学')
    expect(text).toContain('房间1')
    expect(text).toContain(shareUrl)
  })
  it('handles no upcoming lessons', () => {
    const text = composeParentMessage({ studentName: '小明', lessons: [], shareUrl })
    expect(text).toContain('近期暂无排课')
    expect(text).toContain(shareUrl)
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
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 2, 9, h, m)) // 2026-03-09

const cleanup = async () => {
  await db.delete(lesson).where(eq(lesson.tenantId, org))
  await db.delete(classSection).where(eq(classSection.tenantId, org))
  await db.delete(course).where(eq(course.tenantId, org))
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
    const rows = (await forTenant(ctxFor(org, userId)).select(lesson)) as (typeof lesson.$inferSelect)[]
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
})
