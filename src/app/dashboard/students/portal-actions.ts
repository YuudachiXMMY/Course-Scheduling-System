'use server'

import { revalidatePath } from 'next/cache'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { provisionPortalAccountCore, type ProvisionPortalInput } from '@/auth/provision'

export type { ProvisionPortalInput }

// Owner/admin provisions a parent/student login for a student (P7a-1). Thin wrapper over the headless
// core: verify principal + permission, delegate the (idempotent, self-compensating) provision, then
// revalidate. Returns the login email to hand to the family (synthesized for no-email parents).
export async function provisionPortalAccount(
  input: ProvisionPortalInput,
): Promise<{ userId: string; email: string }> {
  const ctx = await requireAuthContext() // 1) verified principal + tenant
  requirePermission(ctx, { member: ['create'] }) // 2) only org managers may mint logins
  const res = await provisionPortalAccountCore(ctx, input) // 3) validate + provision + link (atomic)
  revalidatePath('/dashboard/students')
  return res
}
