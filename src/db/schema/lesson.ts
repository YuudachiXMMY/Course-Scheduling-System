import {
  pgTable,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { primaryId, tenantId, createdAt, updatedAt } from './_helpers'
import { lessonStatus } from './enums'
import { classSection } from './course'

// Materialized-instance model: the recurring PATTERN lives on classSection.rrule;
// a materializer expands it into concrete Lesson rows (each individually editable).
export const lesson = pgTable(
  'lesson',
  {
    id: primaryId(),
    tenantId: tenantId(),
    sectionId: text('section_id').notNull(),
    teacherId: text('teacher_id'), // denormalized from section for conflict queries
    startAt: timestamp('start_at', { withTimezone: true, mode: 'date' }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true, mode: 'date' }).notNull(),
    status: lessonStatus('status').notNull().default('scheduled'),
    location: text('location'),
    title: text('title'),
    notes: text('notes'),
    isException: boolean('is_exception').notNull().default(false), // moved/renamed off pattern, or ad-hoc
    originalStartAt: timestamp('original_start_at', { withTimezone: true, mode: 'date' }), // RECURRENCE-ID slot
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('uq_lesson_tenant_id').on(t.tenantId, t.id),
    foreignKey({
      columns: [t.tenantId, t.sectionId],
      foreignColumns: [classSection.tenantId, classSection.id],
      name: 'fk_lesson_section',
    }).onDelete('cascade'),
    // Idempotent materialization: <=1 row per (section, generated slot). NULL original_start_at (ad-hoc) never collide.
    uniqueIndex('uq_lesson_section_slot').on(t.tenantId, t.sectionId, t.originalStartAt),
    // Phase-2 conflict-detection indexes:
    index('idx_lesson_teacher_time').on(t.tenantId, t.teacherId, t.startAt),
    index('idx_lesson_time_range').on(t.tenantId, t.startAt, t.endAt),
    index('idx_lesson_room_time').on(t.tenantId, t.location, t.startAt),
    index('idx_lesson_tenant_section').on(t.tenantId, t.sectionId),
    index('idx_lesson_tenant_status').on(t.tenantId, t.status),
    check('ck_lesson_time_order', sql`${t.endAt} > ${t.startAt}`),
  ],
)
