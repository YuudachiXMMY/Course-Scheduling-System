import { pgTable, text, timestamp, index, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core'
import { primaryId, tenantId, createdAt, updatedAt } from './_helpers'
import { enrollmentStatus } from './enums'
import { student } from './student'
import { classSection } from './course'

export const enrollment = pgTable(
  'enrollment',
  {
    id: primaryId(),
    tenantId: tenantId(),
    studentId: text('student_id').notNull(),
    sectionId: text('section_id').notNull(),
    status: enrollmentStatus('status').notNull().default('active'),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    droppedAt: timestamp('dropped_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('uq_enrollment_student_section').on(t.tenantId, t.studentId, t.sectionId),
    foreignKey({
      columns: [t.tenantId, t.studentId],
      foreignColumns: [student.tenantId, student.id],
      name: 'fk_enrollment_student',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.tenantId, t.sectionId],
      foreignColumns: [classSection.tenantId, classSection.id],
      name: 'fk_enrollment_section',
    }).onDelete('cascade'),
    index('idx_enrollment_tenant_section').on(t.tenantId, t.sectionId),
    index('idx_enrollment_tenant_student').on(t.tenantId, t.studentId),
  ],
)
