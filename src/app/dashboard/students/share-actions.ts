'use server'

import { nanoid } from 'nanoid'
import { revalidatePath } from 'next/cache'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { actorOwnsStudent } from '@/auth/scope'
import { forTenant } from '@/db/tenant'
import { shareLink } from '@/db/schema'
import { getActiveShare, ensureActiveShare } from '@/app/dashboard/students/share-data'

// One active (non-revoked) share per student. `shareLink` is a NORMAL tenant table here —
// only the PUBLIC page (src/app/s/[token]/page.tsx via src/lib/share.ts) bypasses forTenant()
// (P4-2). Mirrors calendar/actions.ts's getOrCreate/rotate/revoke shape.

// Idempotent: returns the student's active share, creating one on first use. Read-tier (P4-9):
// viewing/copying the share URL requires student:['read'].
export async function getOrCreateShare(studentId: string): Promise<{ token: string }> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { student: ['read'] })
  // 工作流 E: a section-scoped teacher may only mint a public /s/{token} for a student they teach.
  if (!(await actorOwnsStudent(ctx, studentId))) throw new Error('无权分享该学生课表')

  const share = await ensureActiveShare(ctx, studentId)
  revalidatePath('/dashboard/users')
  return { token: share.token }
}

// Rotate = replace the active row's token (do NOT create a duplicate). The old /s/<token> 404s
// immediately because the public page matches on the exact token. Edit-tier (P4-9).
export async function rotateShare(studentId: string): Promise<{ token: string }> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { student: ['update'] })
  if (!(await actorOwnsStudent(ctx, studentId))) throw new Error('无权分享该学生课表')

  const existing = await getActiveShare(ctx, studentId)
  const token = nanoid(32)
  if (!existing) {
    const [created] = await forTenant(ctx).insert(shareLink, {
      studentId,
      token,
      label: '家长课表分享',
    })
    revalidatePath('/dashboard/users')
    return { token: created.token }
  }

  const [updated] = await forTenant(ctx).update(shareLink, existing.id, { token })
  revalidatePath('/dashboard/users')
  return { token: updated.token }
}

// Revoke = tombstone the active share (set revokedAt). Its URL 404s on the next open. Edit-tier (P4-9).
export async function revokeShare(studentId: string): Promise<{ ok: true }> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { student: ['update'] })
  if (!(await actorOwnsStudent(ctx, studentId))) throw new Error('无权分享该学生课表')

  const existing = await getActiveShare(ctx, studentId)
  if (existing) {
    await forTenant(ctx).update(shareLink, existing.id, { revokedAt: new Date() })
    revalidatePath('/dashboard/users')
  }
  return { ok: true }
}
