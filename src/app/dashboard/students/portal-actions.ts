'use server'

import { revalidatePath } from 'next/cache'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import {
  provisionPortalAccountCore,
  provisionSchema,
  type ProvisionPortalInput,
} from '@/auth/provision'

export type { ProvisionPortalInput }

// Owner/admin provisions a parent/student login for a student (P7a-1). Thin wrapper over the headless
// core: verify principal + permission, delegate the (idempotent, self-compensating) provision, then
// revalidate. Returns the synthesized login email to hand to the family — as DATA (not thrown), so
// Chinese business errors ("该邮箱已被其他账号占用", "密码至少 8 位", …) survive Next.js's production
// redaction of thrown Server-Action messages (React #441) and reach the tutor's form intact.
export type ProvisionResult =
  { ok: true; userId: string; email: string; created: boolean } | { ok: false; error: string }

export async function provisionPortalAccount(
  input: ProvisionPortalInput,
): Promise<ProvisionResult> {
  const ctx = await requireAuthContext() // 1) verified principal + tenant
  requirePermission(ctx, { member: ['create'] }) // 2) only org managers may mint logins
  // EH7: validate at the boundary (mirror reschedule/actions.ts) so a Zod failure returns the schema's
  // Chinese per-field message ('密码至少 8 位', …) — NOT the raw multi-line JSON issue dump that leaks
  // when the core's provisionSchema.parse throws and the catch surfaces e.message verbatim.
  const parsed = provisionSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '输入有误' }
  }
  try {
    const res = await provisionPortalAccountCore(ctx, input) // 3) validate + provision + link (atomic)
    revalidatePath('/dashboard/students')
    return { ok: true, ...res }
  } catch (e) {
    console.error('provisionPortalAccount failed', e)
    return { ok: false, error: e instanceof Error ? e.message : '开通登录失败' }
  }
}
