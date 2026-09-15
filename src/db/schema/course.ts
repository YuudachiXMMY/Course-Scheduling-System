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
    defaultMeetingUrl: text('default_meeting_url'), // online-class link (Zoom/腾讯会议) applied to new lessons
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

// A section can meet at DIFFERENT times on different weekdays (e.g. 周一 16:00 / 周三 18:00). A single
// RFC5545 RRULE + one DTSTART can only express ONE time-of-day, so each distinct meeting slot lives
// here as its own row; the materializer builds a per-row RRULE and expands each into Lesson rows.
// Backward-compatible: sections with no meeting rows fall back to classSection.rrule/recurrenceDtstart.
export const sectionMeeting = pgTable(
  'section_meeting',
  {
    id: primaryId(),
    tenantId: tenantId(),
    sectionId: text('section_id').notNull(),
    byDay: text('by_day').notNull(), // single Weekday: MO/TU/WE/TH/FR/SA/SU
    startTime: text('start_time').notNull(), // wall-clock 'HH:mm' in the section's timezone
    durationMinutes: integer('duration_minutes').notNull().default(60),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('uq_meeting_tenant_id').on(t.tenantId, t.id),
    foreignKey({
      columns: [t.tenantId, t.sectionId],
      foreignColumns: [classSection.tenantId, classSection.id],
      name: 'fk_meeting_section',
    }).onDelete('cascade'),
    index('idx_meeting_tenant_section').on(t.tenantId, t.sectionId),
  ],
)
