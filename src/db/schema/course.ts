import {
  pgTable,
  text,
  integer,
  boolean,
  date,
  timestamp,
  index,
  uniqueIndex,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { primaryId, tenantId, createdAt, updatedAt } from './_helpers'

export const course = pgTable(
  'course', // reusable TEMPLATE, tenant-scoped
  {
    id: primaryId(),
    tenantId: tenantId(),
    title: text('title').notNull(),
    subject: text('subject'),
    description: text('description'),
    level: text('level'), // free-form: 初级 / AP / Grade 8
    defaultDurationMinutes: integer('default_duration_minutes').notNull().default(60),
    isArchived: boolean('is_archived').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('uq_course_tenant_id').on(t.tenantId, t.id),
    index('idx_course_tenant').on(t.tenantId),
  ],
)

// A Course pinned to a term. Holds the RECURRENCE DEFAULTS that materialize into Lesson rows.
export const classSection = pgTable(
  'class_section',
  {
    id: primaryId(),
    tenantId: tenantId(),
    courseId: text('course_id').notNull(),
    name: text('name'), // 2026 春季 · 周一班
    teacherId: text('teacher_id'), // -> Better Auth user.id (no Drizzle FK; auth-owned)
    capacity: integer('capacity').notNull().default(1), // 1..15 small group
    termStartDate: date('term_start_date', { mode: 'date' }),
    termEndDate: date('term_end_date', { mode: 'date' }),
    rrule: text('rrule'), // RFC5545 RRULE, NO DTSTART line
    recurrenceDtstart: timestamp('recurrence_dtstart', { withTimezone: true, mode: 'date' }),
    recurrenceTimezone: text('recurrence_timezone').notNull().default('Asia/Shanghai'),
    defaultDurationMinutes: integer('default_duration_minutes'), // overrides course default
    defaultLocation: text('default_location'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('uq_section_tenant_id').on(t.tenantId, t.id),
    foreignKey({
      columns: [t.tenantId, t.courseId],
      foreignColumns: [course.tenantId, course.id],
      name: 'fk_section_course',
    }).onDelete('cascade'),
    index('idx_section_tenant_course').on(t.tenantId, t.courseId),
    index('idx_section_tenant_teacher').on(t.tenantId, t.teacherId),
    check('ck_section_capacity', sql`${t.capacity} between 1 and 15`),
  ],
)
