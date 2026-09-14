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

export async function createReportDraft(input: CreateReportInput): Promise<Report> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { report: ['create'] })
  const data = createSchema.parse(input)
  const row = await createReportDraftCore(ctx, {
    studentId: data.studentId,
    sectionId: data.sectionId,
    title: data.title,
    periodStart: data.periodStart,
    periodEnd: data.periodEnd,
  })
  revalidatePath('/dashboard/reports')
  return row
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
