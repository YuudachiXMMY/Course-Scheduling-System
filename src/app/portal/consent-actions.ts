'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { requireAuthContext } from '@/auth/context'
import { forTenant } from '@/db/tenant'
import { portalLink } from '@/db/schema'

// One-time PIPL/minor-consent capture (P7a-9). Stamps consentedAt on ALL of the acting user's
// portal links (a multi-child parent consents once). Tenant-scoped via forTenant; keyed by the
// verified ctx.userId — never a request param.
export async function acknowledgeConsent(): Promise<void> {
  const ctx = await requireAuthContext()
  const links = await forTenant(ctx).select(portalLink, eq(portalLink.userId, ctx.userId))
  const now = new Date()
  for (const l of links) {
    if (!l.consentedAt) await forTenant(ctx).update(portalLink, l.id, { consentedAt: now })
  }
  revalidatePath('/portal')
}
