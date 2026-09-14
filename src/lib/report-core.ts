import 'server-only'
import type { AuthContext } from '@/auth/context'
import { forTenant } from '@/db/tenant'
import { progressReport } from '@/db/schema'
import { getReportData } from '@/lib/report-data'
import { draftNarrative } from '@/lib/report-draft'
import type { ReportPdfModel } from '@/lib/report-pdf'

// P5: report mutation core — shared by server actions (web) and testable directly with a ctxFor
// (mirrors schedule-core.ts). The draft → approved teacher gate lives here so it holds for every
// caller. All writes go through forTenant(ctx); tenantId is injected from the verified principal.

export type Report = typeof progressReport.$inferSelect

export interface CreateReportInput {
  studentId: string
  sectionId?: string | null
  periodStart: Date
  periodEnd: Date
  title?: string | null
}

export async function createReportDraftCore(ctx: AuthContext, input: CreateReportInput): Promise<Report> {
  const data = await getReportData(ctx, input.studentId, { from: input.periodStart, to: input.periodEnd })
  const draft = await draftNarrative(data)
  const [row] = (await forTenant(ctx).insert(progressReport, {
    studentId: input.studentId,
    sectionId: input.sectionId ?? null,
    title: input.title ?? null,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    narrative: draft.narrative,
    rubricVersion: draft.rubricVersion,
    model: draft.model,
    status: 'draft',
    createdBy: ctx.userId,
  })) as Report[]
  return row
}

export async function updateReportNarrativeCore(
  ctx: AuthContext,
  id: string,
  narrative: string,
): Promise<Report> {
  const existing = (await forTenant(ctx).findById(progressReport, id)) as Report | null
  if (!existing) throw new Error('报告不存在')
  if (existing.status === 'approved') throw new Error('报告已定稿，不可修改')
  const [row] = (await forTenant(ctx).update(progressReport, id, { narrative })) as Report[]
  return row
}

export async function approveReportCore(ctx: AuthContext, id: string): Promise<Report> {
  const existing = (await forTenant(ctx).findById(progressReport, id)) as Report | null
  if (!existing) throw new Error('报告不存在')
  if (existing.status === 'approved') throw new Error('报告已定稿')
  const [row] = (await forTenant(ctx).update(progressReport, id, {
    status: 'approved',
    approvedBy: ctx.userId,
    approvedAt: new Date(),
  })) as Report[]
  return row
}

// Build the PDF view-model: report row (frozen narrative/status) + fresh numbers from the DB,
// scoped to the report's own period window (deterministic given the period).
export async function getReportViewModel(
  ctx: AuthContext,
  id: string,
  generatedAt: string,
): Promise<ReportPdfModel | null> {
  const r = (await forTenant(ctx).findById(progressReport, id)) as Report | null
  if (!r) return null
  const to = r.periodEnd ?? new Date()
  const from = r.periodStart ?? new Date(0)
  const data = await getReportData(ctx, r.studentId, { from, to })
  return {
    studentName: data.studentName,
    schoolGrade: data.schoolGrade,
    periodStart: data.periodStart,
    periodEnd: data.periodEnd,
    title: r.title,
    status: r.status,
    narrative: r.narrative,
    attendance: data.attendance,
    grades: data.grades,
    gradeAverage: data.gradeAverage,
    generatedAt,
  }
}
