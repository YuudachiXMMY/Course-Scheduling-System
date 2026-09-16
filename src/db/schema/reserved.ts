import {
  pgTable,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/pg-core'
import { primaryId, tenantId, createdAt, updatedAt } from './_helpers'
import { rescheduleStatus, paymentStatus } from './enums'
import { lesson } from './lesson'
import { student } from './student'

export const rescheduleRequest = pgTable(
  'reschedule_request',
  {
    id: primaryId(),
    tenantId: tenantId(),
    lessonId: text('lesson_id').notNull(),
    // Phase 7a: which child this request is for. A lesson's section may hold up to 15 students, so
    // the lesson alone can't identify the child — the portal write path sets + authorizes on this.
    // Nullable so the migration doesn't break any pre-existing rows; every new portal request sets it.
    studentId: text('student_id'),
    requestedById: text('requested_by_id'), // parent/student user.id
    requestedStartAt: timestamp('requested_start_at', { withTimezone: true, mode: 'date' }),
    requestedEndAt: timestamp('requested_end_at', { withTimezone: true, mode: 'date' }),
    reason: text('reason'),
    status: rescheduleStatus('status').notNull().default('pending'),
    reviewedById: text('reviewed_by_id'), // teacher user.id
    reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),
    // Reviewer's note on a decision (chiefly a reject reason surfaced back to the parent/student).
    // Nullable: pre-existing rows and approvals carry none.
    reviewNote: text('review_note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.lessonId],
      foreignColumns: [lesson.tenantId, lesson.id],
      name: 'fk_reschedule_lesson',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.tenantId, t.studentId],
      foreignColumns: [student.tenantId, student.id],
      name: 'fk_reschedule_student',
    }).onDelete('cascade'),
    index('idx_reschedule_tenant_status').on(t.tenantId, t.status),
    index('idx_reschedule_tenant_lesson').on(t.tenantId, t.lessonId), // M7: covers fk_reschedule_lesson
    index('idx_reschedule_tenant_student').on(t.tenantId, t.studentId),
  ],
)

export const creditPackage = pgTable(
  'credit_package',
  {
    id: primaryId(),
    tenantId: tenantId(),
    studentId: text('student_id').notNull(),
    name: text('name'),
    totalCredits: integer('total_credits'),
    remainingCredits: integer('remaining_credits'),
    priceCents: integer('price_cents'),
    currency: text('currency').notNull().default('CNY'),
    purchasedAt: timestamp('purchased_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('uq_credit_tenant_id').on(t.tenantId, t.id),
    // H1: credit balances are financial records — block hard deletes of the owning student.
    foreignKey({
      columns: [t.tenantId, t.studentId],
      foreignColumns: [student.tenantId, student.id],
      name: 'fk_credit_student',
    }).onDelete('restrict'),
    index('idx_credit_tenant_student').on(t.tenantId, t.studentId),
  ],
)

export const payment = pgTable(
  'payment',
  {
    id: primaryId(),
    tenantId: tenantId(),
    studentId: text('student_id').notNull(),
    creditPackageId: text('credit_package_id'),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('CNY'),
    status: paymentStatus('status').notNull().default('pending'),
    method: text('method'),
    paidAt: timestamp('paid_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // H1: payments are immutable accounting history — never cascade-delete with the student.
    foreignKey({
      columns: [t.tenantId, t.studentId],
      foreignColumns: [student.tenantId, student.id],
      name: 'fk_payment_student',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.tenantId, t.creditPackageId],
      foreignColumns: [creditPackage.tenantId, creditPackage.id],
      name: 'fk_payment_credit',
    }).onDelete('set null'), // package can be retired; the payment row survives with a null link
    index('idx_payment_tenant_student').on(t.tenantId, t.studentId),
    index('idx_payment_tenant_credit').on(t.tenantId, t.creditPackageId), // M7: covers fk_payment_credit
  ],
)
