'use server'

import { revalidatePath } from 'next/cache'
import { AuthError, requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import {
  createPortalUserCore,
  linkPortalUserCore,
  unlinkPortalUserCore,
  type CreatePortalUserInput,
  type LinkPortalUserInput,
} from '@/auth/provision'
import { updateUserInfoCore, setUserNoteCore, type UpdateUserInfoInput } from '@/auth/staff'
import { BusinessError } from '@/lib/errors'

// Business errors are returned as DATA (not thrown) so Chinese messages ("该邮箱已被其他账号占用", …)
// survive Next.js's production redaction of thrown Server-Action messages (React #441) — mirrors
// students/portal-actions.ts.
export type CreateUserResult =
  { ok: true; userId: string; email: string; created: boolean } | { ok: false; error: string }
export type MutResult = { ok: true } | { ok: false; error: string }

// Create a parent/student login (no student link yet). Only org managers may mint logins.
export async function createPortalUser(input: CreatePortalUserInput): Promise<CreateUserResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { member: ['create'] })
  try {
    const res = await createPortalUserCore(ctx, input)
    revalidatePath('/dashboard/users')
    return { ok: true, ...res }
  } catch (e) {
    console.error('createPortalUser failed', e)
    return { ok: false, error: e instanceof Error ? e.message : '新建用户失败' }
  }
}

// Assign an existing portal user to a student (idempotent). Both "parent → student" and
// "student → parent" UI directions call this.
export async function linkPortalUser(input: LinkPortalUserInput): Promise<MutResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { member: ['create'] })
  try {
    await linkPortalUserCore(ctx, input)
    revalidatePath('/dashboard/users')
    return { ok: true }
  } catch (e) {
    console.error('linkPortalUser failed', e)
    return { ok: false, error: e instanceof Error ? e.message : '关联失败' }
  }
}

export async function unlinkPortalUser(userId: string, studentId: string): Promise<MutResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { member: ['delete'] })
  try {
    await unlinkPortalUserCore(ctx, userId, studentId)
    revalidatePath('/dashboard/users')
    return { ok: true }
  } catch (e) {
    console.error('unlinkPortalUser failed', e)
    return { ok: false, error: e instanceof Error ? e.message : '解绑失败' }
  }
}

// Edit an account's display name + login email (家长/教师/管理员 「编辑」). Five-step boundary mirroring
// staff-actions.ts: coarse member:create gate INSIDE the try, then the fine tiered gate lives in the core
// (assertCanManageRole). AuthError('FORBIDDEN') is translated to a Chinese message so the raw code never
// leaks; the core's own '该邮箱已被占用' / '不能在此编辑自己的信息' surface as data (React #441-safe).
export async function updateUserInfo(
  targetUserId: string,
  input: UpdateUserInfoInput,
): Promise<MutResult> {
  const ctx = await requireAuthContext()
  try {
    requirePermission(ctx, { member: ['create'] })
    await updateUserInfoCore(ctx, targetUserId, input)
    revalidatePath('/dashboard/users')
    return { ok: true }
  } catch (e) {
    console.error('updateUserInfo failed', e)
    if (e instanceof AuthError) return { ok: false, error: '无权编辑该账号信息' }
    // CWE-209: forward ONLY a BusinessError's message (safe by construction). A raw ZodError / DB fault must
    // never reach the client verbatim — collapse it to a generic fallback.
    if (e instanceof BusinessError) return { ok: false, error: e.message }
    return { ok: false, error: '保存失败' }
  }
}

// Set/clear the admin-internal note on a parent/teacher/admin account. Same tiered gate (annotating an
// admin/owner account is super-admin-only, enforced in the core).
export async function setUserNote(targetUserId: string, note: string): Promise<MutResult> {
  const ctx = await requireAuthContext()
  try {
    requirePermission(ctx, { member: ['create'] })
    await setUserNoteCore(ctx, targetUserId, note)
    revalidatePath('/dashboard/users')
    return { ok: true }
  } catch (e) {
    console.error('setUserNote failed', e)
    if (e instanceof AuthError) return { ok: false, error: '无权编辑该账号备注' }
    if (e instanceof BusinessError) return { ok: false, error: e.message }
    return { ok: false, error: '保存备注失败' }
  }
}
