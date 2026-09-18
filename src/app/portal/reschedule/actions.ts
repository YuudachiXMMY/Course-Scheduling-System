'use server'

import { revalidatePath } from 'next/cache'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { requireConsent } from '@/auth/portal'
import {
  createRescheduleRequestCore,
  cancelRescheduleRequestCore,
  createRescheduleRequestSchema,
  type RescheduleRequestRow,
} from '@/lib/reschedule-core'
import { toPortalActionError } from '@/lib/errors'
import type { z } from 'zod'

// Thin portal wrappers over reschedule-core (mirrors reports/actions.ts). Every action:
// requireAuthContext → requirePermission → validate → core → revalidatePath. Problems are returned
// as DATA (not thrown): Next.js redacts thrown Server-Action messages in production to the opaque
// React #441, so a Zod failure or a Chinese business error ("无权访问该学生", "该学生未在此班级", …)
// would never reach the client. Returning the message keeps it intact for the form.
export type CreateRescheduleInput = z.input<typeof createRescheduleRequestSchema>
export type RescheduleActionResult =
  { ok: true; request: RescheduleRequestRow } | { ok: false; error: string }

export async function createRescheduleRequest(
  input: CreateRescheduleInput,
): Promise<RescheduleActionResult> {
  const ctx = await requireAuthContext()
  try {
    // EH8: permission + consent live INSIDE the try so their AuthError/BusinessError is translated by
    // toPortalActionError rather than escaping to the opaque React #441 (silent failure).
    requirePermission(ctx, { rescheduleRequest: ['create'] })
    await requireConsent(ctx) // 服务端同意门复检：提交改期（触碰孩子课表）前必须已同意
    const parsed = createRescheduleRequestSchema.safeParse(input)
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? '输入有误' }
    }
    const row = await createRescheduleRequestCore(ctx, input)
    revalidatePath('/portal/reschedule')
    return { ok: true, request: row }
  } catch (e) {
    // EH8 (CWE-209): forward only user-safe messages; internal errors collapse to '提交失败'.
    return toPortalActionError(e, '提交失败')
  }
}

export async function cancelRescheduleRequest(id: string): Promise<RescheduleActionResult> {
  const ctx = await requireAuthContext()
  try {
    requirePermission(ctx, { rescheduleRequest: ['cancel'] })
    await requireConsent(ctx) // 服务端同意门复检：取消改期前必须已同意
    if (!id) return { ok: false, error: '无效的申请' }
    const row = await cancelRescheduleRequestCore(ctx, id)
    revalidatePath('/portal/reschedule')
    return { ok: true, request: row }
  } catch (e) {
    return toPortalActionError(e, '取消失败')
  }
}
