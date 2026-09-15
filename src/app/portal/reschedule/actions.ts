'use server'

import { revalidatePath } from 'next/cache'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import {
  createRescheduleRequestCore,
  cancelRescheduleRequestCore,
  createRescheduleRequestSchema,
  type RescheduleRequestRow,
} from '@/lib/reschedule-core'
import type { z } from 'zod'

// Thin portal wrappers over reschedule-core (mirrors reports/actions.ts). Every action:
// requireAuthContext → requirePermission → validate → core → revalidatePath. Problems are returned
// as DATA (not thrown): Next.js redacts thrown Server-Action messages in production to the opaque
// React #441, so a Zod failure or a Chinese business error ("无权访问该学生", "该学生未在此班级", …)
// would never reach the client. Returning the message keeps it intact for the form.
export type CreateRescheduleInput = z.input<typeof createRescheduleRequestSchema>
export type RescheduleActionResult =
  | { ok: true; request: RescheduleRequestRow }
  | { ok: false; error: string }

export async function createRescheduleRequest(
  input: CreateRescheduleInput,
): Promise<RescheduleActionResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { rescheduleRequest: ['create'] })
  const parsed = createRescheduleRequestSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '输入有误' }
  }
  try {
    const row = await createRescheduleRequestCore(ctx, input)
    revalidatePath('/portal/reschedule')
    return { ok: true, request: row }
  } catch (e) {
    console.error('createRescheduleRequest failed', e)
    return { ok: false, error: e instanceof Error ? e.message : '提交失败' }
  }
}

export async function cancelRescheduleRequest(id: string): Promise<RescheduleActionResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { rescheduleRequest: ['cancel'] })
  if (!id) return { ok: false, error: '无效的申请' }
  try {
    const row = await cancelRescheduleRequestCore(ctx, id)
    revalidatePath('/portal/reschedule')
    return { ok: true, request: row }
  } catch (e) {
    console.error('cancelRescheduleRequest failed', e)
    return { ok: false, error: e instanceof Error ? e.message : '取消失败' }
  }
}
