import {
  pgTable,
  text,
  numeric,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { primaryId, tenantId, createdAt, updatedAt } from './_helpers'
import { student } from './student'
import { lesson } from './lesson'
import { classSection } from './course'

export const grade = pgTable(
  'grade',
  {
    id: primaryId(),
    tenantId: tenantId(),
    studentId: text('student_id').notNull(),
    lessonId: text('lesson_id'), // nullable — per-lesson grade
    sectionId: text('section_id'), // nullable — per-term grade
    title: text('title'),
    score: numeric('score', { precision: 6, scale: 2 }), // NB: node-pg returns numeric as string
    maxScore: numeric('max_score', { precision: 6, scale: 2 }),
    rubric: jsonb('rubric').$type<Record<string, unknown>>(),
    comment: text('comment'),
    gradedBy: text('graded_by'), // -> user.id
    gradedAt: timestamp('graded_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // H1: grades are academic records with retention value — block hard deletes of a referenced
    // student / lesson / section. Archive the parent instead of deleting it.
    foreignKey({
      columns: [t.tenantId, t.studentId],
      foreignColumns: [student.tenantId, student.id],
      name: 'fk_grade_student',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.tenantId, t.lessonId],
      foreignColumns: [lesson.tenantId, lesson.id],
      name: 'fk_grade_lesson',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.tenantId, t.sectionId],
      foreignColumns: [classSection.tenantId, classSection.id],
      name: 'fk_grade_section',
    }).onDelete('restrict'),
    index('idx_grade_tenant_student').on(t.tenantId, t.studentId),
    index('idx_grade_tenant_lesson').on(t.tenantId, t.lessonId),
    index('idx_grade_tenant_section').on(t.tenantId, t.sectionId), // M7: covers fk_grade_section
    // F5: the quick-grade upsert (data.ts) is a select-then-write keyed on (lesson, student, title) with
    // no lock/tx — two concurrent writes both see no row and both INSERT → duplicate rows that
    // report-stats double-counts into the parent PDF average. This partial unique index is the backstop
    // (mirrors uq_attendance_lesson_student): a race now hits 23505 instead of silently duplicating, and
    // the upsert converts that to an UPDATE. Partial so it only governs lesson+title grades (the only
    // insert path); section-scoped or untitled grades are unaffected.
    uniqueIndex('uq_grade_lesson_student_title')
      .on(t.tenantId, t.lessonId, t.studentId, t.title)
      .where(sql`${t.lessonId} is not null and ${t.title} is not null`),
    check('ck_grade_target', sql`${t.lessonId} is not null or ${t.sectionId} is not null`),
  ],
)
