import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { student, portalLink, progressReport } from '@/db/schema'
import { getPortalReports } from '@/app/portal/reports/data'
import type { AuthContext } from '@/auth/context'
import { seedOrg, unseedOrg } from './helpers/seed-org'

// Phase 5 —— 家长门户报告的行级隔离 + approved-only。
// 家长 A 关联孩子 X、Y；别家孩子 Z 不关联 A。X 有 1 approved + 1 draft，Z 有 1 approved。
// 断言 getPortalReports(A) 只见 X 的 approved：不含 X 的 draft、不含 Z 的任何报告。
const org = 'org_portal_report_scope'
const parentA = 'u_parent_prs'
const stuX = 'stu_x_prs'
const stuY = 'stu_y_prs'
const stuZ = 'stu_z_prs'

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
  await db.insert(student).values([
    { id: stuX, tenantId: org, name: '学生X' },
    { id: stuY, tenantId: org, name: '学生Y' },
    { id: stuZ, tenantId: org, name: '学生Z' },
  ])
  // 家长 A 关联 X、Y（各一行，consentedAt 已 stamp，否则 requireConsent 抛错）。Z 不关联 A。
  await db.insert(portalLink).values([
    {
      tenantId: org,
      studentId: stuX,
      userId: parentA,
      relationship: 'parent',
      consentedAt: new Date(),
    },
    {
      tenantId: org,
      studentId: stuY,
      userId: parentA,
      relationship: 'parent',
      consentedAt: new Date(),
    },
  ])
  await db.insert(progressReport).values([
    {
      id: 'rpt_x_approved',
      tenantId: org,
      studentId: stuX,
      title: 'X 的期末报告',
      status: 'approved',
      rubricVersion: 'v1',
      narrative: 'X 家长可见叙述',
    },
    {
      id: 'rpt_x_draft',
      tenantId: org,
      studentId: stuX,
      title: 'X 的草稿报告',
      status: 'draft',
      rubricVersion: 'v1',
      narrative: 'X 草稿勿外传',
    },
    {
      id: 'rpt_z_approved',
      tenantId: org,
      studentId: stuZ,
      title: 'Z 的期末报告',
      status: 'approved',
      rubricVersion: 'v1',
      narrative: 'Z 家长可见叙述',
    },
  ])
})

afterAll(cleanup)

describe('getPortalReports —— 行级 scope + approved-only', () => {
  it('只含关联学生 X 的 approved 报告（排除 X draft 与别家 Z）', async () => {
    const { reports } = await getPortalReports(ctx)
    const ids = reports.map((r) => r.id)
    expect(ids).toEqual(['rpt_x_approved'])
    expect(ids).not.toContain('rpt_x_draft')
    expect(ids).not.toContain('rpt_z_approved')
    expect(reports[0]?.studentName).toBe('学生X')
  })

  it('筛选选项只覆盖关联学生（X、Y），不泄露别家学生', async () => {
    const { students } = await getPortalReports(ctx)
    const names = students.map((s) => s.name).sort()
    expect(names).toEqual(['学生X', '学生Y'])
  })
})
