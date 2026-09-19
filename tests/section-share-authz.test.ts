import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { course, classSection, sectionShareLink } from '@/db/schema'
import type { AuthContext } from '@/auth/context'
import {
  getActiveSectionShare,
  ensureActiveSectionShare,
} from '@/app/dashboard/teach/[sectionId]/section-share-data'
import { seedOrg, unseedOrg } from './helpers/seed-org'

// ── B1 回归（orch-review #45–#49，commit f29a988，HIGH） ────────────────────────────────────────────────
//
// 被发现的越权：getActiveSectionShare / ensureActiveSectionShare 原来只按 (tenant + sectionId) 过滤，没有
// 归属校验。ExportPanel 仅凭 lesson:read 就会调用它 —— 于是一个 section-scoped teacher 打开「他人班级」的
// 导出 tab，就能拿到那个班级「有效的公开分享 token」，该 token 被渲染成公开、免认证的 /sec/{token} 整班课表
// URL（一个跨 teacher-scope 边界的持久公开访问 capability）。
//
// 修复：在两个 loader 前加 actorOwnsSectionById 自持守卫 —— 非 owner 在 READ 路径拿 null，在 CREATE 路径抛错
//（对齐 requireOwnedSection「data 层独立校验，不只靠 layout」不变量，以及兄弟写操作 getOrCreate/rotate/revoke）。
//
// 这些测试锁住那个守卫。它们直接以选定 principal 调用 core（不经 'use server' 动作），所以无需 mock
// requireAuthContext —— 且刻意只从 section-share-data 引入，避开触达 web-push 的 push-core 链。
// AI 回归测试原则：为「发现过的 bug」写测试，而不是为「本就正确的代码」写测试。

const org = 'org_section_share_authz'
const teacherA = 'u_teacher_a_share'
const teacherB = 'u_teacher_b_share'
const ownerId = 'u_owner_share'
const adminId = 'u_admin_share'

const sA = 's_a_share' // teacherA 拥有；预置一个 active 分享（activeTokenSA）
const sB = 's_b_share' // teacherB 拥有；预置一个 active 分享（activeTokenSB）—— 用于「非归属读他人真实 token」
const sC = 's_c_share' // teacherA 拥有；无分享 —— owner 铸造路径
const sD = 's_d_share' // teacherA 拥有；无分享 —— 非归属拦截路径（与 sC 分开，消除 it 顺序耦合）

// 预置的有效公开 token —— B1 泄漏的正是这类值。
const activeTokenSA = 'b1regr_active_share_token_for_section_a'
const activeTokenSB = 'b1regr_active_share_token_for_section_b'

const ctxFor = (userId: string, role: string, isPlatformAdmin = false): AuthContext => ({
  tenantId: org,
  userId,
  role,
  isPlatformAdmin,
})
const teacherACtx = ctxFor(teacherA, 'teacher')
const teacherBCtx = ctxFor(teacherB, 'teacher')
const ownerCtx = ctxFor(ownerId, 'owner')
const adminCtx = ctxFor(adminId, 'admin') // 另一个 whole-tenant 角色 —— 守 allow 侧不被过度收紧

const activeSharesFor = (sectionId: string) =>
  db
    .select()
    .from(sectionShareLink)
    .where(
      and(
        eq(sectionShareLink.tenantId, org),
        eq(sectionShareLink.sectionId, sectionId),
        isNull(sectionShareLink.revokedAt),
      ),
    )

const cleanup = async () => {
  await db.delete(sectionShareLink).where(eq(sectionShareLink.tenantId, org))
  await db.delete(classSection).where(eq(classSection.tenantId, org))
  await db.delete(course).where(eq(course.tenantId, org))
  await unseedOrg(org)
}

beforeAll(async () => {
  await cleanup()
  await seedOrg(org)
  await db.insert(course).values({ id: 'c_share', tenantId: org, title: '班级分享归属课程' })
  await db.insert(classSection).values([
    { id: sA, tenantId: org, courseId: 'c_share', name: 'A', teacherId: teacherA, capacity: 5 },
    { id: sB, tenantId: org, courseId: 'c_share', name: 'B', teacherId: teacherB, capacity: 5 },
    { id: sC, tenantId: org, courseId: 'c_share', name: 'C', teacherId: teacherA, capacity: 5 },
    { id: sD, tenantId: org, courseId: 'c_share', name: 'D', teacherId: teacherA, capacity: 5 },
  ])
  // sA、sB 各一个 active 分享（id/createdAt/updatedAt 走默认，revokedAt 默认 null）。
  await db.insert(sectionShareLink).values([
    { tenantId: org, sectionId: sA, token: activeTokenSA, label: '班级课表分享' },
    { tenantId: org, sectionId: sB, token: activeTokenSB, label: '班级课表分享' },
  ])
})

afterAll(cleanup)

describe('B1 回归 — 班级公开分享 token 归属守卫', () => {
  // 基线健全性：sA / sB 上确实各存在一个 active 分享。这样下面 READ 路径返回 null 只可能来自「归属守卫」，
  // 而不是「压根没有分享」—— 否则测试会空跑通过（AI 自审最常见的盲点）。
  it('基线：sA、sB 上各存在一个 active（未撤销）分享', async () => {
    expect((await activeSharesFor(sA))[0]?.token).toBe(activeTokenSA)
    expect((await activeSharesFor(sB))[0]?.token).toBe(activeTokenSB)
  })

  it('READ 泄漏（核心）：非归属 teacher 读他人班级分享 → null，绝不返回实时 token', async () => {
    // 修复前：teacherB 会拿到 sA 的有效 token（被渲染成公开 /sec/{token} URL）。修复后：null。
    expect(await getActiveSectionShare(teacherBCtx, sA)).toBeNull()
    // 对称方向同样封堵：teacherA 读他人 sB（sB 确有真实 token）→ 仍是 null，证明拦的是「真 token」而非「无分享」。
    expect(await getActiveSectionShare(teacherACtx, sB)).toBeNull()
  })

  it('READ owner：归属 teacher 读到自己班级的 active 分享（token 一致）', async () => {
    expect((await getActiveSectionShare(teacherACtx, sA))?.token).toBe(activeTokenSA)
    expect((await getActiveSectionShare(teacherBCtx, sB))?.token).toBe(activeTokenSB)
  })

  it('READ whole-tenant：owner / admin 可读整租户任意班级的分享（allow 侧不被过度收紧）', async () => {
    expect((await getActiveSectionShare(ownerCtx, sA))?.token).toBe(activeTokenSA)
    expect((await getActiveSectionShare(adminCtx, sB))?.token).toBe(activeTokenSB)
  })

  it('READ 猜测/不存在的 sectionId → null（永不抛错，行为契约）', async () => {
    expect(await getActiveSectionShare(teacherBCtx, 'sec-does-not-exist')).toBeNull()
  })

  it('WRITE 非归属：ensure 对他人无分享的班级抛错，且绝不铸造 token', async () => {
    // sD 归 teacherA、无 active 分享。修复前非 owner 会 fall through 到 insert，在他人班级铸造分享。
    // 用独立的 sD（非 sC）→ 与下面 owner 铸造互不耦合，去掉 it 执行顺序依赖。
    await expect(ensureActiveSectionShare(teacherBCtx, sD)).rejects.toThrow('无权分享该班级课表')
    const minted = await db
      .select()
      .from(sectionShareLink)
      .where(and(eq(sectionShareLink.tenantId, org), eq(sectionShareLink.sectionId, sD)))
    expect(minted).toHaveLength(0) // 守卫在 insert 之前拦截 → 零铸造
  })

  it('WRITE owner 幂等：归属 teacher 对已有 active 分享的班级 ensure → 复用同一 token，不重复铸造', async () => {
    const share = await ensureActiveSectionShare(teacherACtx, sA)
    expect(share.token).toBe(activeTokenSA)
    expect(await activeSharesFor(sA)).toHaveLength(1) // 仍只有一个 active
  })

  it('WRITE owner 铸造：归属 teacher 对无分享的班级 ensure → 铸造 32 位 nanoid token', async () => {
    const share = await ensureActiveSectionShare(teacherACtx, sC)
    expect(share.sectionId).toBe(sC)
    expect(share.token).toHaveLength(32)
    expect(await activeSharesFor(sC)).toHaveLength(1)
  })
})
