import {
  pgTable,
  text,
  date,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/pg-core'
import { primaryId, tenantId, createdAt, updatedAt } from './_helpers'
import { reportStatus } from './enums'
import { student } from './student'
import { classSection } from './course'
import type { ReportData } from '@/lib/report-stats'

// Phase 5: per-student progress report. Narrative is Claude-drafted then teacher-edited; numbers
// (attendance/grades) are rendered from the DB at PDF time, never stored here (no LLM-fabricated
// facts). draft → approved is a one-way teacher gate: approved reports are locked from edits.
export const progressReport = pgTable(
  'progress_report',
  {
    id: primaryId(),
    tenantId: tenantId(),
    studentId: text('student_id').notNull(),
    sectionId: text('section_id'), // nullable — a report may span a student's whole schedule
    title: text('title'),
    periodStart: date('period_start', { mode: 'date' }),
    periodEnd: date('period_end', { mode: 'date' }),
    narrative: text('narrative'), // AI-drafted + teacher-edited prose (NO numbers)
    // Numbers snapshot frozen at APPROVE time so an approved report is reproducible: attendance/
    // grades edited after approval must not silently change the finalized PDF (M1). Null while draft
    // — drafts recompute live from the DB. Shape = ReportData (JSON-safe: no Date fields).
    statsSnapshot: jsonb('stats_snapshot').$type<ReportData>(),
    rubricVersion: text('rubric_version').notNull(), // which RUBRIC[version] drafted it (reproducibility)
    model: text('model'), // audit: which Claude model drafted the narrative
    status: reportStatus('status').notNull().default('draft'),
    approvedBy: text('approved_by'), // -> user.id
    approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'date' }),
    createdBy: text('created_by'), // -> user.id
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('uq_report_tenant_id').on(t.tenantId, t.id),
    // H1: reports are academic records — block hard deletes of a referenced student. Archive the
    // student instead. Section may be retired independently, so set_null there.
    foreignKey({
      columns: [t.tenantId, t.studentId],
      foreignColumns: [student.tenantId, student.id],
      name: 'fk_report_student',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.tenantId, t.sectionId],
      foreignColumns: [classSection.tenantId, classSection.id],
      name: 'fk_report_section',
    }).onDelete('set null'),
    index('idx_report_tenant_student').on(t.tenantId, t.studentId),
    index('idx_report_tenant_status').on(t.tenantId, t.status),
    index('idx_report_tenant_section').on(t.tenantId, t.sectionId), // covers fk_report_section
  ],
)
