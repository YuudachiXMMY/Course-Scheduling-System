import { pgTable, text, timestamp, index, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core'
import { primaryId, tenantId, createdAt, updatedAt } from './_helpers'
import { attendanceStatus } from './enums'
import { lesson } from './lesson'
import { student } from './student'

export const attendance = pgTable(
  'attendance',
  {
    id: primaryId(),
    tenantId: tenantId(),
    lessonId: text('lesson_id').notNull(),
    studentId: text('student_id').notNull(),
    status: attendanceStatus('status').notNull().default('present'),
    note: text('note'),
    recordedBy: text('recorded_by'), // -> user.id
    recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('uq_attendance_lesson_student').on(t.tenantId, t.lessonId, t.studentId), // upsertable per occurrence
    foreignKey({
      columns: [t.tenantId, t.lessonId],
      foreignColumns: [lesson.tenantId, lesson.id],
      name: 'fk_attendance_lesson',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.tenantId, t.studentId],
      foreignColumns: [student.tenantId, student.id],
      name: 'fk_attendance_student',
    }).onDelete('cascade'),
    index('idx_attendance_tenant_student').on(t.tenantId, t.studentId),
  ],
)
