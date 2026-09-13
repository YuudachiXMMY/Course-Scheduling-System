import {
  pgTable,
  text,
  numeric,
  jsonb,
  timestamp,
  index,
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
    foreignKey({
      columns: [t.tenantId, t.studentId],
      foreignColumns: [student.tenantId, student.id],
      name: 'fk_grade_student',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.tenantId, t.lessonId],
      foreignColumns: [lesson.tenantId, lesson.id],
      name: 'fk_grade_lesson',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.tenantId, t.sectionId],
      foreignColumns: [classSection.tenantId, classSection.id],
      name: 'fk_grade_section',
    }).onDelete('cascade'),
    index('idx_grade_tenant_student').on(t.tenantId, t.studentId),
    index('idx_grade_tenant_lesson').on(t.tenantId, t.lessonId),
    check('ck_grade_target', sql`${t.lessonId} is not null or ${t.sectionId} is not null`),
  ],
)
