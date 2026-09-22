import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { forTenant } from '@/db/tenant'
import { actorOwnsSectionById } from '@/auth/scope'
import { sectionShareLink } from '@/db/schema'
import { defaultShareExpiry, isTokenTimeActive } from '@/lib/share-ttl'
import type { AuthContext } from '@/auth/context'

type SectionShare = typeof sectionShareLink.$inferSelect

// Active (non-revoked) share for ONE section, on the forTenant spine (M1). The section mirror of
// students/share-data.ts's getActiveShare (功能2).
//
// 工作流 E: this loader SELF-ENFORCES section ownership (like requireOwnedSection for the other
// per-section loaders in this route's data.ts) — NOT only via the layout guard. It also feeds the
// export tab's read (ExportPanel/getActiveSectionShare), and a section-scoped teacher who opens a
// FOREIGN section's export tab must never receive that section's live `token`: it is rendered into a
// public, unauthenticated `/sec/{token}` URL (src/app/sec/[token]/page.tsx) that serves the whole
// class schedule, i.e. a persistent public-access capability across the teacher-scope boundary. A
// non-owner (or a guessed/stale same-tenant sectionId) gets `null`, never a token. The write callers
// (getOrCreate/rotate/revoke) already pre-check the same guard, so a real owner always passes here too.
export async function getActiveSectionShare(
  ctx: AuthContext,
  sectionId: string,
): Promise<SectionShare | null> {
  if (!(await actorOwnsSectionById(ctx, sectionId))) return null
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
  // 工作流 E: self-sufficient ownership guard on the CREATE path too — getActiveSectionShare returns
  // null for a non-owner, so without this a foreign/guessed sectionId would fall through to the insert
  // below and mint a share on another teacher's class. getOrCreateSectionShare already pre-checks, so a
  // real owner always passes; this throws (not null) because minting on an unowned section is a hard error.
  if (!(await actorOwnsSectionById(ctx, sectionId))) throw new Error('无权分享该班级课表')
  const existing = await getActiveSectionShare(ctx, sectionId)
  if (existing) {
    if (isTokenTimeActive(existing.expiresAt)) return existing
    // H6: active-but-expired → renew in place (same token) so the shared /sec/<token> URL keeps working.
    const [renewed] = await forTenant(ctx).update(sectionShareLink, existing.id, {
      expiresAt: defaultShareExpiry(),
    })
    return renewed
  }
  const [created] = await forTenant(ctx).insert(sectionShareLink, {
    sectionId,
    token: nanoid(32),
    label: '班级课表分享',
    expiresAt: defaultShareExpiry(),
  })
  return created
}
