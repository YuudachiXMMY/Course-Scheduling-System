import { pgTable, text, timestamp, index, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { primaryId, tenantId, createdAt, updatedAt } from './_helpers'
import { notificationType } from './enums'
import { lesson } from './lesson'
import { student } from './student'

// Phase 7b: the persisted, tenant-isolated in-app notification store — the source of truth for
// delivery (Web Push is best-effort on top). Rows are written by the system (cron reminder scan +
// reschedule outcome), not by a user verb, and read back per recipient in the notification center.
export const notification = pgTable(
  'notification',
  {
    id: primaryId(),
    tenantId: tenantId(),
    userId: text('user_id').notNull(), // recipient = Better Auth user.id — bare text, NO FK (auth-owned)
    type: notificationType('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    url: text('url'), // deep link opened on notificationclick
    lessonId: text('lesson_id'),
    studentId: text('student_id'),
    dedupeKey: text('dedupe_key'), // idempotency for reminders; null for one-shot events
    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Idempotent reminder dispatch: at most one row per (tenant, dedupeKey) when the key is set.
    uniqueIndex('uq_notification_dedupe')
      .on(t.tenantId, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
    // Cascade (NOT set null): a composite FK's SET NULL would try to null tenant_id (NOT NULL) and
    // fail at delete time — matches reschedule_request. userId has NO FK (auth-owned).
    foreignKey({
      columns: [t.tenantId, t.lessonId],
      foreignColumns: [lesson.tenantId, lesson.id],
      name: 'fk_notification_lesson',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.tenantId, t.studentId],
      foreignColumns: [student.tenantId, student.id],
      name: 'fk_notification_student',
    }).onDelete('cascade'),
    index('idx_notification_tenant_user').on(t.tenantId, t.userId),
    index('idx_notification_tenant_user_read').on(t.tenantId, t.userId, t.readAt), // unread queries
    index('idx_notification_tenant_lesson').on(t.tenantId, t.lessonId), // M7: covers fk_notification_lesson
    index('idx_notification_tenant_student').on(t.tenantId, t.studentId), // M7: covers fk_notification_student
  ],
)
