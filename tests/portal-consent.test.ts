import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { forTenant } from '@/db/tenant'
import { student, portalLink } from '@/db/schema'
import { requireAuthContext, type AuthContext } from '@/auth/context'
import { requireConsent } from '@/auth/portal'
import { getPortalSchedule } from '@/app/portal/data'

// Slice F（B40）——门户同意门服务端复检。layout.tsx 的 ConsentGate 只在渲染层拦截（UX 级）；门户的
// Server Action 与数据加载器必须在触碰个人数据前独立复检 consentedAt，否则一个从未点"我已阅读并同意"
// 的家长/学生可直接调用这些动作，绕过 PIPL/未成年人同意门。这里锁住 requireConsent 及其在加载器/动作
// 层的接入。

// createRescheduleRequest（'use server'）内部调用 requireAuthContext()（会话 cookie）——仅覆写该导出，
// 用 importActual 保留 AuthError，使 requirePermission 仍能工作；库加载器（getPortalSchedule）与
// requireConsent 直接吃 ctx，不受此 mock 影响。
vi.mock('@/auth/context', async (importActual) => ({
  ...(await importActual<typeof import('@/auth/context')>()),
  requireAuthContext: vi.fn(),
}))
// revalidatePath 在请求存储之外会抛错；同意门在触达它之前就拒绝，但仍打桩以防放行路径炸在 cache 调用上。
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createRescheduleRequest } from '@/app/portal/reschedule/actions'

const asActor = (ctx: AuthContext) => vi.mocked(requireAuthContext).mockResolvedValue(ctx)

const org = 'org_consent_f'
const parentNoConsent = 'u_parent_noconsent_f' // 有链接但未同意
const parentConsented = 'u_parent_consent_f' // 有链接且已同意
const parentNoLinks = 'u_parent_nolinks_f' // 门户角色但零链接
const ownerUser = 'u_owner_consent_f' // staff，不受同意门约束

const ctxFor = (userId: string, role: string): AuthContext => ({
  tenantId: org,
  userId,
  role,
  isPlatformAdmin: false,
})
const noConsentCtx = ctxFor(parentNoConsent, 'parent')
const consentedCtx = ctxFor(parentConsented, 'parent')
const noLinksCtx = ctxFor(parentNoLinks, 'parent')
const ownerCtx = ctxFor(ownerUser, 'owner')

let studentA = '' // linked to parentNoConsent
let studentB = '' // linked to parentConsented

const CONSENT_ERR = '请先阅读并同意隐私条款'

const cleanup = async () => {
  await db.delete(portalLink).where(eq(portalLink.tenantId, org))
  await db.delete(student).where(eq(student.tenantId, org))
}

describe('门户同意门服务端复检（Slice F / B40）', () => {
  beforeAll(async () => {
    await cleanup()
    const [a] = (await forTenant(ownerCtx).insert(student, { name: '学生A' })) as { id: string }[]
    const [b] = (await forTenant(ownerCtx).insert(student, { name: '学生B' })) as { id: string }[]
    studentA = a.id
    studentB = b.id
    await forTenant(ownerCtx).insert(portalLink, {
      studentId: studentA,
      userId: parentNoConsent,
      relationship: 'parent',
      // consentedAt 缺省 → null → 未同意
    })
    await forTenant(ownerCtx).insert(portalLink, {
      studentId: studentB,
      userId: parentConsented,
      relationship: 'parent',
      consentedAt: new Date(), // 已同意
    })
  })
  afterAll(cleanup)

  // ── requireConsent 原语 ──────────────────────────────────────────────────────────────────────
  describe('requireConsent(ctx) 原语', () => {
    it('未同意的门户用户 → 抛「请先阅读并同意隐私条款」', async () => {
      await expect(requireConsent(noConsentCtx)).rejects.toThrow(CONSENT_ERR)
    })

    it('已同意的门户用户 → 放行', async () => {
      await expect(requireConsent(consentedCtx)).resolves.toBeUndefined()
    })

    it('零链接的门户用户 → 放行（无个人数据可保护，语义同 layout 的 needsConsent）', async () => {
      await expect(requireConsent(noLinksCtx)).resolves.toBeUndefined()
    })

    it('staff 角色（owner）不受同意门约束 → 放行', async () => {
      await expect(requireConsent(ownerCtx)).resolves.toBeUndefined()
    })
  })

  // ── 数据加载器：门户课表 ──────────────────────────────────────────────────────────────────────
  describe('getPortalSchedule 加载器', () => {
    it('未同意用户读孩子课表 → 抛同意门错误', async () => {
      await expect(getPortalSchedule(noConsentCtx)).rejects.toThrow(CONSENT_ERR)
    })

    it('已同意用户 → 通过，返回其绑定学生的课表卡片', async () => {
      const cards = await getPortalSchedule(consentedCtx)
      expect(cards.map((c) => c.studentId)).toContain(studentB)
    })
  })

  // ── Server Action：改期申请 ───────────────────────────────────────────────────────────────────
  describe('createRescheduleRequest Server Action', () => {
    it('未同意用户提交改期 → 返回同意门错误（EH8：{ok,error} 判别式，不再向不可信客户端抛原始错误）', async () => {
      asActor(noConsentCtx)
      // EH8/CWE-209：动作把 requireConsent 抛出的 BusinessError 收敛为 {ok:false, error}，
      // 消息原样保留（同意门仍在数据访问前强制，请求不会被创建）。
      const res = await createRescheduleRequest(
        {} as Parameters<typeof createRescheduleRequest>[0],
      )
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toBe(CONSENT_ERR)
    })

    it('已同意用户 → 越过同意门（此后可因其它既有校验被拒，但不再是同意门错误）', async () => {
      asActor(consentedCtx)
      const res = await createRescheduleRequest(
        {} as Parameters<typeof createRescheduleRequest>[0],
      )
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).not.toBe(CONSENT_ERR)
    })
  })
})
