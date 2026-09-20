'use server'

import { revalidatePath } from 'next/cache'
import { AuthError, requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import {
  createStaffUserCore,
  setStaffRoleCore,
  deactivateStaffCore,
  reactivateStaffCore,
  type CreateStaffInput,
} from '@/auth/staff'
import { resetUserPasswordCore } from '@/auth/password'

// Staff-management Server Actions (teachers/admins tabs). Five-step boundary: trusted principal →
// COARSE gate (member:create — is this actor a manager at all; teacher/assistant fail here) → FINE
// tiered gate inside the core (assertCanManageRole, which reserves admin/owner targets for super admins)
// → DB write → revalidate. Business errors are returned as DATA (not thrown) so the Chinese messages
// survive Next.js's production redaction of thrown Server-Action messages — mirrors user-actions.ts.
export type MutResult = { ok: true } | { ok: false; error: string }
export type CreateStaffResult = { ok: true; userId: string } | { ok: false; error: string }

// EH6: requirePermission moves INSIDE the try (mirror courses/actions.ts) so a coarse FORBIDDEN is
// returned as data instead of escaping to Next's opaque React #441; AND assertCanManageRole's
// AuthError('FORBIDDEN') (thrown inside each core) is translated to a Chinese message rather than
// leaking the raw code 'FORBIDDEN' (=== AuthError.message) into the UI.
export async function createStaffUser(input: CreateStaffInput): Promise<CreateStaffResult> {
  const ctx = await requireAuthContext()
  try {
    requirePermission(ctx, { member: ['create'] })
    const res = await createStaffUserCore(ctx, input)
    revalidatePath('/dashboard/users')
    return { ok: true, ...res }
  } catch (e) {
    console.error('createStaffUser failed', e)
    if (e instanceof AuthError) return { ok: false, error: '无权新建该员工' }
    return { ok: false, error: e instanceof Error ? e.message : '新建员工失败' }
  }
}

export async function setStaffRole(targetUserId: string, newRole: string): Promise<MutResult> {
  const ctx = await requireAuthContext()
  try {
    requirePermission(ctx, { member: ['create'] })
    await setStaffRoleCore(ctx, targetUserId, newRole)
    revalidatePath('/dashboard/users')
    return { ok: true }
  } catch (e) {
    console.error('setStaffRole failed', e)
    if (e instanceof AuthError) return { ok: false, error: '无权修改角色' }
    return { ok: false, error: e instanceof Error ? e.message : '修改角色失败' }
  }
}

export async function deactivateStaff(targetUserId: string): Promise<MutResult> {
  const ctx = await requireAuthContext()
  try {
    requirePermission(ctx, { member: ['create'] })
    await deactivateStaffCore(ctx, targetUserId)
    revalidatePath('/dashboard/users')
    return { ok: true }
  } catch (e) {
    console.error('deactivateStaff failed', e)
    if (e instanceof AuthError) return { ok: false, error: '无权停用该员工' }
    return { ok: false, error: e instanceof Error ? e.message : '停用失败' }
  }
}

// Admin "帮忙重置密码" for ANY account in the org (portal parent/student OR staff teacher/assistant/admin).
// Same five-step boundary: coarse member:create gate here, fine tiered gate inside the core
// (assertCanManageRole — a regular manager cannot reset an admin/owner). AuthError('FORBIDDEN') from the
// core is translated to a Chinese message so the raw code never leaks; other errors surface as data.
export async function resetUserPassword(
  targetUserId: string,
  newPassword: string,
): Promise<MutResult> {
  const ctx = await requireAuthContext()
  try {
    requirePermission(ctx, { member: ['create'] })
    await resetUserPasswordCore(ctx, targetUserId, newPassword)
    revalidatePath('/dashboard/users')
    return { ok: true }
  } catch (e) {
    console.error('resetUserPassword failed', e)
    if (e instanceof AuthError) return { ok: false, error: '无权重置该账号密码' }
    return { ok: false, error: e instanceof Error ? e.message : '重置密码失败' }
  }
}

export async function reactivateStaff(targetUserId: string): Promise<MutResult> {
  const ctx = await requireAuthContext()
  try {
    requirePermission(ctx, { member: ['create'] })
    await reactivateStaffCore(ctx, targetUserId)
    revalidatePath('/dashboard/users')
    return { ok: true }
  } catch (e) {
    console.error('reactivateStaff failed', e)
    if (e instanceof AuthError) return { ok: false, error: '无权启用该员工' }
    return { ok: false, error: e instanceof Error ? e.message : '启用失败' }
  }
}
