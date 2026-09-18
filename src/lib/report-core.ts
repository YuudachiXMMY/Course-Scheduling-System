import 'server-only'
import type { AuthContext } from '@/auth/context'
import { actorOwnsStudent } from '@/auth/scope'
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

export async function createReportDraftCore(
  ctx: AuthContext,
  input: CreateReportInput,
): Promise<Report> {
  // 工作流 E: a section-scoped teacher may only draft a report for a student in a section they teach.
  if (!(await actorOwnsStudent(ctx, input.studentId))) throw new Error('无权为该学生创建报告')
  const data = await getReportData(ctx, input.studentId, {
    from: input.periodStart,
    to: input.periodEnd,
  })
  const draft = await draftNarrative(data)
  const [row] = await forTenant(ctx).insert(progressReport, {
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
  })
  return row
}

export async function updateReportNarrativeCore(
  ctx: AuthContext,
  id: string,
  narrative: string,
): Promise<Report> {
  const existing = await forTenant(ctx).findById(progressReport, id)
  if (!existing) throw new Error('报告不存在')
  if (!(await actorOwnsStudent(ctx, existing.studentId))) throw new Error('无权修改该报告')
  if (existing.status === 'approved') throw new Error('报告已定稿，不可修改')
  const [row] = await forTenant(ctx).update(progressReport, id, { narrative })
  return row
}

export async function approveReportCore(ctx: AuthContext, id: string): Promise<Report> {
  const existing = await forTenant(ctx).findById(progressReport, id)
  if (!existing) throw new Error('报告不存在')
  if (!(await actorOwnsStudent(ctx, existing.studentId))) throw new Error('无权定稿该报告')
  if (existing.status === 'approved') throw new Error('报告已定稿')
  // Freeze the numbers at approval time (M1): recompute once from the live DB over the report's
  // period, then store the snapshot so the finalized PDF is reproducible even if attendance/grades
  // change later. The frozen narrative and frozen numbers stay in sync.
  const statsSnapshot = await getReportData(ctx, existing.studentId, {
    from: existing.periodStart ?? new Date(0),
    to: existing.periodEnd ?? new Date(),
  })
  const [row] = await forTenant(ctx).update(progressReport, id, {
    status: 'approved',
    approvedBy: ctx.userId,
    approvedAt: new Date(),
    statsSnapshot,
  })
  return row
}

// Build the PDF view-model: report row (frozen narrative/status) + numbers scoped to the report's
// period. Approved reports read the snapshot frozen at approval (M1 — reproducible); drafts
// recompute live so previews reflect the latest DB state.
export async function getReportViewModel(
  ctx: AuthContext,
  id: string,
  generatedAt: string,
): Promise<ReportPdfModel | null> {
  const r = await forTenant(ctx).findById(progressReport, id)
  if (!r) return null
  // 工作流 E: null (→ route 404) if a section-scoped teacher requests a report whose student is not in
  // a section they teach — the /api/reports/[reportId]/pdf route bypasses the RSC layout guard.
  if (!(await actorOwnsStudent(ctx, r.studentId))) return null
  const data =
    r.status === 'approved' && r.statsSnapshot
      ? r.statsSnapshot
      : await getReportData(ctx, r.studentId, {
          from: r.periodStart ?? new Date(0),
          to: r.periodEnd ?? new Date(),
        })
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
