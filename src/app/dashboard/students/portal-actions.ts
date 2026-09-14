'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { nanoid } from 'nanoid'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { forTenant } from '@/db/tenant'
import { student, portalLink } from '@/db/schema'
import { env } from '@/env'
import { provisionPortalMember } from '@/auth/provision'

// M3: server actions are a public boundary — validate/normalize every field before it hits the DB.
const provisionSchema = z.object({
  studentId: z.string().trim().min(1),
  name: z.string().trim().min(1, '姓名不能为空').max(100),
  kind: z.enum(['parent', 'student']),
  loginId: z.string().trim().max(100).optional(), // optional real email; else a placeholder is synthesized
  password: z.string().min(8, '密码至少 8 位'),
})
export type ProvisionPortalInput = z.input<typeof provisionSchema>

// Owner/admin provisions a parent/student login for a student (P7a-1). Returns the login email to
// hand to the family (synthesized for WeChat-only, no-email parents).
export async function provisionPortalAccount(
  input: ProvisionPortalInput,
): Promise<{ userId: string; email: string }> {
  const ctx = await requireAuthContext() // 1) verified principal + tenant
  requirePermission(ctx, { member: ['create'] }) // 2) only org managers may mint logins
  const data = provisionSchema.parse(input) // 3) validate

  const s = (await forTenant(ctx).findById(student, data.studentId)) as typeof student.$inferSelect | null
  if (!s) throw new Error('学生不存在')

  const email =
    data.loginId && data.loginId.includes('@')
      ? data.loginId.toLowerCase()
      : `portal_${nanoid()}@${env.PORTAL_EMAIL_DOMAIN}`

  const { userId } = await provisionPortalMember({
    name: data.name,
    email,
    password: data.password,
    orgId: ctx.tenantId,
    orgRole: data.kind,
  })

  // 4) domain link (tenant-scoped write; tenantId injected by forTenant)
  await forTenant(ctx).insert(portalLink, {
    studentId: data.studentId,
    userId,
    relationship: data.kind,
  })
  revalidatePath('/dashboard/students')
  return { userId, email }
}
