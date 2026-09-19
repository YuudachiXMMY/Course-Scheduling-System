import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { student, portalLink, progressReport } from '@/db/schema'
import { getPortalReports } from '@/app/portal/reports/data'
import { WHOLE_SCHEDULE_KEY } from '@/app/portal/reports/constants'
import type { AuthContext } from '@/auth/context'
import { seedOrg, unseedOrg } from './helpers/seed-org'

// ── 回归：WHOLE_SCHEDULE_KEY 哨兵不得为空串（found+fixed in commit 828da02，code-review MEDIUM） ──────────
//
// 家长门户报告页有两个筛选桶：「全部课程」= <option value="">（show-all 哨兵），「全程」= 整校历报告
//（sectionId === null）。整程桶的 id 用 WHOLE_SCHEDULE_KEY 标记。若该常量退化为空串 ''，它就与 show-all 的
// 空串相撞：reports-list.tsx 的 `!sectionId` 短路会让「全程」静默等同于「全部课程」，家长再也无法只筛整程报告。
// 修复把它定为非空 '__whole__'，并让 data.ts 的桶 key(`r.sectionId ?? WHOLE_SCHEDULE_KEY`)与前端筛选比较共用。
//
// 为什么现有测试抓不到（completeness critic 的盲点）：B2 边界测试只断言「WHOLE_SCHEDULE_KEY 从 ./constants
// 值导入」这条 import-source 轴，从不校验它的「值」；portal-report-scope.test.ts 驱动 getPortalReports 但只断言
// reports 行级 scope 与 students，从不碰 sections。于是把常量改回 '' 会让全部测试仍绿，却重新引入撞车。
// 这里锁住那条载荷不变量：整程（null section）报告必须产出一个「非空、且等于 WHOLE_SCHEDULE_KEY」的筛选桶。

const org = 'org_portal_whole_schedule_key'
const parentA = 'u_parent_wsk'
const stuX = 'stu_x_wsk'

const ctx: AuthContext = { tenantId: org, userId: parentA, role: 'parent', isPlatformAdmin: false }

const cleanup = async () => {
  await db.delete(progressReport).where(eq(progressReport.tenantId, org))
  await db.delete(portalLink).where(eq(portalLink.tenantId, org))
  await db.delete(student).where(eq(student.tenantId, org))
  await unseedOrg(org)
}

beforeAll(async () => {
  await cleanup()
  await seedOrg(org)
  await db.insert(student).values({ id: stuX, tenantId: org, name: '学生X' })
  await db.insert(portalLink).values({
    tenantId: org,
    studentId: stuX,
    userId: parentA,
    relationship: 'parent',
    consentedAt: new Date(), // 否则 requireConsent 抛错
  })
  // 一条 approved 的「整程」报告：不带 sectionId → r.sectionId 为 null → 落入 WHOLE_SCHEDULE_KEY 桶。
  await db.insert(progressReport).values({
    id: 'rpt_x_whole',
    tenantId: org,
    studentId: stuX,
    title: 'X 的整程报告',
    status: 'approved',
    rubricVersion: 'v1',
    narrative: 'X 整程叙述',
  })
})

afterAll(cleanup)

describe('回归 — 家长门户「全程」筛选桶哨兵（WHOLE_SCHEDULE_KEY 非空）', () => {
  it('WHOLE_SCHEDULE_KEY 是非空哨兵（否则与 show-all 的 <option value=""> 相撞）', () => {
    expect(WHOLE_SCHEDULE_KEY).not.toBe('')
  })

  it('整程（null section）报告产出一个 id === WHOLE_SCHEDULE_KEY、label 「全程」、且非空的筛选桶', async () => {
    const { sections } = await getPortalReports(ctx)
    const whole = sections.find((s) => s.label === '全程')
    expect(whole, '整程报告应产生一个「全程」筛选桶').toBeTruthy()
    expect(whole?.id).toBe(WHOLE_SCHEDULE_KEY)
    expect(whole?.id).not.toBe('') // 载荷不变量：桶 id 非空 → 不与 show-all 撞车
  })
})
