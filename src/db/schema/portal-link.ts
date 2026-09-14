import { pgTable, text, timestamp, index, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core'
import { primaryId, tenantId, createdAt, updatedAt } from './_helpers'
import { portalRelationship } from './enums'
import { student } from './student'

// Phase 7a: links a Better Auth `user` to the domain `student` row(s) they may access through the
// login portal — the schema gap that blocks "a parent sees ONLY their own child". A join table
// (mirrors enrollment) so ONE parent ↔ MANY children AND a student ↔ themselves both work.
export const portalLink = pgTable(
  'portal_link',
  {
    id: primaryId(),
    tenantId: tenantId(),
    studentId: text('student_id').notNull(),
    userId: text('user_id').notNull(), // Better Auth user.id — bare text, NO FK (auth-owned tables)
    relationship: portalRelationship('relationship').notNull(),
    consentedAt: timestamp('consented_at', { withTimezone: true, mode: 'date' }), // PIPL consent stamp (P7a-9)
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // At most one link per (tenant, student, user) — idempotent provisioning / re-link.
    uniqueIndex('uq_portal_link_student_user').on(t.tenantId, t.studentId, t.userId),
    foreignKey({
      columns: [t.tenantId, t.studentId],
      foreignColumns: [student.tenantId, student.id],
      name: 'fk_portal_link_student',
    }).onDelete('cascade'),
    index('idx_portal_link_tenant_user').on(t.tenantId, t.userId), // "which students may this user see"
    index('idx_portal_link_tenant_student').on(t.tenantId, t.studentId),
  ],
)
