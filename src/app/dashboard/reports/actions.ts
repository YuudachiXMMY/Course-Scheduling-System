'use server'

import { z } from 'zod'
import { inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { studentIdsForActor } from '@/auth/scope'
import { forTenant } from '@/db/tenant'
import { progressReport } from '@/db/schema'
import {
  createReportDraftCore,
  updateReportNarrativeCore,
  approveReportCore,
  type Report,
} from '@/lib/report-core'

// Thin web wrappers over report-core (mirrors schedule/actions.ts → schedule-core). Every action:
// requireAuthContext → requirePermission → zod parse → core → revalidatePath.

const createSchema = z
  .object({
    studentId: z.string().min(1),
    sectionId: z.string().min(1).optional(),
    title: z.string().trim().max(200).optional(),
    // date-only strings from the form; coerce to Date.
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
  })
  .refine((v) => v.periodEnd >= v.periodStart, {
    message: '结束日期不能早于开始日期',
    path: ['periodEnd'],
  })
export type CreateReportInput = z.input<typeof createSchema>

// Return validation/generation problems as DATA instead of throwing (mirrors courses/createSection):
// Next.js redacts thrown Server Action error messages in production, so a Zod failure or a core
// error (missing ANTHROPIC_API_KEY, "报告已定稿", "学生不存在", …) would otherwise surface as the
// opaque "Minified React error #441" (Server Components render error). Returning the message reaches
// the client intact. Every mutating report action shares this shape so the panel handles them uniformly.
export type ReportResult = { ok: true; report: Report } | { ok: false; error: string }

export async function createReportDraft(input: CreateReportInput): Promise<ReportResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { report: ['create'] })
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '输入有误' }
  }
  const data = parsed.data
  try {
    const row = await createReportDraftCore(ctx, {
      studentId: data.studentId,
      sectionId: data.sectionId,
      title: data.title,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
    })
    revalidatePath('/dashboard/reports')
    return { ok: true, report: row }
  } catch (e) {
    // Keep the stack in server logs (the redacted message is all the client would otherwise get).
    console.error('createReportDraft failed', e)
    return { ok: false, error: e instanceof Error ? e.message : '生成报告失败' }
  }
}

const updateSchema = z.object({ id: z.string().min(1), narrative: z.string().max(20_000) })
export type UpdateReportInput = z.input<typeof updateSchema>

export async function updateReportNarrative(input: UpdateReportInput): Promise<ReportResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { report: ['update'] })
  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '输入有误' }
  }
  try {
    const row = await updateReportNarrativeCore(ctx, parsed.data.id, parsed.data.narrative)
    revalidatePath('/dashboard/reports')
    return { ok: true, report: row }
  } catch (e) {
    console.error('updateReportNarrative failed', e)
    return { ok: false, error: e instanceof Error ? e.message : '保存失败' }
  }
}

export async function approveReport(id: string): Promise<ReportResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { report: ['approve'] })
  const parsed = z.string().min(1).safeParse(id)
  if (!parsed.success) {
    return { ok: false, error: '无效的报告 ID' }
  }
  try {
    const row = await approveReportCore(ctx, parsed.data)
    revalidatePath('/dashboard/reports')
    return { ok: true, report: row }
  } catch (e) {
    console.error('approveReport failed', e)
    return { ok: false, error: e instanceof Error ? e.message : '批准失败' }
  }
}

export async function listReports(): Promise<Report[]> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { report: ['list'] })
  // 工作流 E: confine a teacher to their roster's reports (same scope as getReportsPageData) — this
  // action has no caller today, but scoping it keeps the confinement airtight if it is ever wired up.
  const scope = await studentIdsForActor(ctx)
  if (scope !== 'all' && scope.length === 0) return []
  return await forTenant(ctx).select(
    progressReport,
    scope === 'all' ? undefined : inArray(progressReport.studentId, scope),
  )
}
