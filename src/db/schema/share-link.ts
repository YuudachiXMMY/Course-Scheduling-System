import { pgTable, text, timestamp, index, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { primaryId, tenantId, createdAt, updatedAt } from './_helpers'
import { student } from './student'

// P4-1: per-student, revocable capability. The public page (src/app/s/[token]/page.tsx) resolves a
// token to this row and reads THAT student's lessons WITHOUT an AuthContext (P4-2, via src/lib/share.ts).
export const shareLink = pgTable(
  'share_link',
  {
    id: primaryId(),
    tenantId: tenantId(),
    studentId: text('student_id').notNull(),
    token: text('token').notNull(), // 32-char nanoid capability; unguessable; rotatable
    label: text('label'),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    // H6: capability expiry. NULLABLE — existing rows (expires_at IS NULL) mean "never expires"
    // (grandfathered, backward-compatible); only newly issued/rotated tokens carry a TTL. The public
    // resolver treats NULL as infinite (see src/lib/share.ts).
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('uq_share_link_tenant_id').on(t.tenantId, t.id),
    // GLOBAL unique index (not tenant-prefixed): the public page looks up by token alone.
    uniqueIndex('uq_share_link_token').on(t.token),
    // One ACTIVE share per student (mirror enrollment M6); revoked rows don't block re-issue.
    uniqueIndex('uq_share_link_active_student')
      .on(t.tenantId, t.studentId)
      .where(sql`${t.revokedAt} is null`),
    foreignKey({
      columns: [t.tenantId, t.studentId],
      foreignColumns: [student.tenantId, student.id],
      name: 'fk_share_link_student',
    }).onDelete('cascade'),
    index('idx_share_link_tenant_student').on(t.tenantId, t.studentId),
  ],
)
