'use server'

import { revalidatePath } from 'next/cache'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import {
  createPortalUserCore,
  linkPortalUserCore,
  unlinkPortalUserCore,
  type CreatePortalUserInput,
  type LinkPortalUserInput,
} from '@/auth/provision'

// Business errors are returned as DATA (not thrown) so Chinese messages ("该邮箱已被其他账号占用", …)
// survive Next.js's production redaction of thrown Server-Action messages (React #441) — mirrors
// students/portal-actions.ts.
export type CreateUserResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; error: string }
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
