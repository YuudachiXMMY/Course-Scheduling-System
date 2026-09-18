import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db } from '@/db'
import { organization, user, member } from '@/db/schema'

// 评审 Slice E / B43 —— member 表 (organization_id, user_id) 唯一约束。项目直接写 member.role（绕过
// Better Auth 需会话的 setRole），重试/竞态可能插入第二行；RBAC 读路径 .limit(1) 无 ORDER BY 会非确定性
// 返回任一行。此约束在 DB 层兜底，杜绝重复成员行。
const orgId = 'org_member_uq'
const userId = 'u_member_uq'

const cleanup = async () => {
  await db.delete(member).where(eq(member.organizationId, orgId))
  await db.delete(user).where(eq(user.id, userId))
  await db.delete(organization).where(eq(organization.id, orgId))
}

beforeAll(async () => {
  await cleanup()
  await db
    .insert(organization)
    .values({ id: orgId, name: '唯一约束机构', slug: `slug-${orgId}`, createdAt: new Date() })
  await db.insert(user).values({
    id: userId,
    name: '成员',
    email: `${userId}@member.local`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
})

afterAll(cleanup)

describe('member (organization_id, user_id) 唯一约束', () => {
  it('拒绝同一 (org, user) 的第二条成员行', async () => {
    await db
      .insert(member)
      .values({ id: nanoid(), organizationId: orgId, userId, role: 'teacher', createdAt: new Date() })
    await expect(
      db
        .insert(member)
        .values({ id: nanoid(), organizationId: orgId, userId, role: 'admin', createdAt: new Date() }),
    ).rejects.toThrow()
  })
})
