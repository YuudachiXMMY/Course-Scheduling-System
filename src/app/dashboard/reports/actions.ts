'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
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

// Return validation / draft failures as data instead of throwing: Next.js redacts thrown Server
// Action error messages in production (they surface as the opaque "Minified React error #441"), so
// a missing ANTHROPIC_API_KEY or a Zod field error must be RETURNED to reach the client with a
// helpful message. Mirrors courses/actions.ts → CreateSectionResult.
export type CreateReportResult = { ok: true; report: Report } | { ok: false; error: string }

export async function createReportDraft(input: CreateReportInput): Promise<CreateReportResult> {
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
    return { ok: false, error: e instanceof Error ? e.message : '生成草稿失败' }
  }
}

const updateSchema = z.object({ id: z.string().min(1), narrative: z.string().max(20_000) })
export type UpdateReportInput = z.input<typeof updateSchema>

export async function updateReportNarrative(input: UpdateReportInput): Promise<Report> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { report: ['update'] })
  const data = updateSchema.parse(input)
  const row = await updateReportNarrativeCore(ctx, data.id, data.narrative)
  revalidatePath('/dashboard/reports')
  return row
}

export async function approveReport(id: string): Promise<Report> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { report: ['approve'] })
  const row = await approveReportCore(ctx, z.string().min(1).parse(id))
  revalidatePath('/dashboard/reports')
  return row
}

export async function listReports(): Promise<Report[]> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { report: ['list'] })
  return (await forTenant(ctx).select(progressReport)) as Report[]
}
