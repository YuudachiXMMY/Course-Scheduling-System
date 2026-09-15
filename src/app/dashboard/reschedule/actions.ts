'use server'

import { revalidatePath } from 'next/cache'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import {
  approveRescheduleRequestCore,
  rejectRescheduleRequestCore,
  type ApproveResult,
  type RescheduleRequestRow,
} from '@/lib/reschedule-core'

// Teacher/admin review actions. Approve returns the core's ApproveResult union verbatim so the panel
// can render conflicts + 建议时段 on a soft double-booking (the request stays pending) instead of
// assuming success. Both actions revalidate the review list; approve ALSO revalidates the calendar
// because a successful approve MOVES the lesson via rescheduleLessonCore.
export type ApproveActionResult = ApproveResult | { ok: false; error: string }
export type RejectActionResult =
  | { ok: true; request: RescheduleRequestRow }
  | { ok: false; error: string }

export async function approveRescheduleRequest(id: string): Promise<ApproveActionResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { rescheduleRequest: ['approve'] })
  try {
    const res = await approveRescheduleRequestCore(ctx, id)
    if (res.ok) {
      revalidatePath('/dashboard/reschedule')
      revalidatePath('/dashboard/schedule')
    }
    return res
  } catch (e) {
    console.error('approveRescheduleRequest failed', e)
    return { ok: false, error: e instanceof Error ? e.message : '审批失败' }
  }
}

export async function rejectRescheduleRequest(id: string): Promise<RejectActionResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { rescheduleRequest: ['reject'] })
  try {
    const row = await rejectRescheduleRequestCore(ctx, id)
    revalidatePath('/dashboard/reschedule')
    return { ok: true, request: row }
  } catch (e) {
    console.error('rejectRescheduleRequest failed', e)
    return { ok: false, error: e instanceof Error ? e.message : '拒绝失败' }
  }
}
