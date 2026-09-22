'use server'

import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { acknowledgeCrossBorderAiCore } from '@/lib/report-consent'

// H3: capture the organization's one-time acknowledgment that AI report drafting sends student data to
// a cross-border LLM provider (PIPEDA). Gated on report:create — whoever may draft a report may make
// this acknowledgment, so a drafting teacher is never locked out waiting on someone else. Keyed by the
// verified ctx (org = ctx.tenantId, actor = ctx.userId), never a request param.
export async function acknowledgeCrossBorderAi(): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { report: ['create'] })
  try {
    await acknowledgeCrossBorderAiCore(ctx)
    return { ok: true }
  } catch (e) {
    console.error('acknowledgeCrossBorderAi failed', e)
    return { ok: false, error: e instanceof Error ? e.message : '确认失败' }
  }
}
