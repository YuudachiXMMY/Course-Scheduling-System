import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { forTenant } from '@/db/tenant'
import { sectionShareLink } from '@/db/schema'
import type { AuthContext } from '@/auth/context'

type SectionShare = typeof sectionShareLink.$inferSelect

// Active (non-revoked) share for ONE section, on the forTenant spine (M1). The section mirror of
// students/share-data.ts's getActiveShare (功能2).
export async function getActiveSectionShare(
  ctx: AuthContext,
  sectionId: string,
): Promise<SectionShare | null> {
  const rows = await forTenant(ctx).select(
    sectionShareLink,
    and(eq(sectionShareLink.sectionId, sectionId), isNull(sectionShareLink.revokedAt)),
  )
  return rows[0] ?? null
}

// Idempotent: returns the section's active share, creating one (32-char nanoid capability) on first
// use. The partial-unique index (tenant_id, section_id WHERE revoked_at IS NULL) enforces
// one-active-per-section and guards the getOrCreate race (功能2).
export async function ensureActiveSectionShare(
  ctx: AuthContext,
  sectionId: string,
): Promise<SectionShare> {
  const existing = await getActiveSectionShare(ctx, sectionId)
  if (existing) return existing
  const [created] = await forTenant(ctx).insert(sectionShareLink, {
    sectionId,
    token: nanoid(32),
    label: '班级课表分享',
  })
  return created
}
