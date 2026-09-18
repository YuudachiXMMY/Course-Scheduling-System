'use server'

import { nanoid } from 'nanoid'
import { revalidatePath } from 'next/cache'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { actorOwnsSectionById } from '@/auth/scope'
import { forTenant } from '@/db/tenant'
import { sectionShareLink } from '@/db/schema'
import {
  getActiveSectionShare,
  ensureActiveSectionShare,
} from '@/app/dashboard/teach/[sectionId]/section-share-data'

// One active (non-revoked) share per section. `sectionShareLink` is a NORMAL tenant table here —
// only the PUBLIC page (src/app/sec/[token]/page.tsx via src/lib/share.ts) bypasses forTenant().
// Mirrors students/share-actions.ts's getOrCreate/rotate/revoke shape (功能2).

// Idempotent: returns the section's active share, creating one on first use. Read-tier: viewing/
// copying the share URL requires lesson:['read'].
export async function getOrCreateSectionShare(sectionId: string): Promise<{ token: string }> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['read'] })
  // 工作流 E: a section-scoped teacher may only mint a public /sec/{token} for a section they teach.
  if (!(await actorOwnsSectionById(ctx, sectionId))) throw new Error('无权分享该班级课表')

  const share = await ensureActiveSectionShare(ctx, sectionId)
  revalidatePath('/dashboard/teach/' + sectionId)
  return { token: share.token }
}

// Rotate = replace the active row's token (do NOT create a duplicate). The old /sec/<token> 404s
// immediately because the public page matches on the exact token. Edit-tier.
export async function rotateSectionShare(sectionId: string): Promise<{ token: string }> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['update'] })
  if (!(await actorOwnsSectionById(ctx, sectionId))) throw new Error('无权分享该班级课表')

  const existing = await getActiveSectionShare(ctx, sectionId)
  const token = nanoid(32)
  if (!existing) {
    const [created] = await forTenant(ctx).insert(sectionShareLink, {
      sectionId,
      token,
      label: '班级课表分享',
    })
    revalidatePath('/dashboard/teach/' + sectionId)
    return { token: created.token }
  }

  const [updated] = await forTenant(ctx).update(sectionShareLink, existing.id, { token })
  revalidatePath('/dashboard/teach/' + sectionId)
  return { token: updated.token }
}

// Revoke = tombstone the active share (set revokedAt). Its URL 404s on the next open. Edit-tier.
export async function revokeSectionShare(sectionId: string): Promise<{ ok: true }> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['update'] })
  if (!(await actorOwnsSectionById(ctx, sectionId))) throw new Error('无权分享该班级课表')

  const existing = await getActiveSectionShare(ctx, sectionId)
  if (existing) {
    await forTenant(ctx).update(sectionShareLink, existing.id, { revokedAt: new Date() })
    revalidatePath('/dashboard/teach/' + sectionId)
  }
  return { ok: true }
}
