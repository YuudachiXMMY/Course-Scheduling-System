import { pgTable, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { primaryId, tenantId, createdAt, updatedAt } from './_helpers'

// P3-1: tenant-scoped, revocable capability feed. The `token` IS the capability —
// the public subscription route (src/app/api/calendar/[token]/route.ts) resolves a
// token to this row and reads that tenant's lessons WITHOUT an AuthContext (P3-2).
export const calendarFeed = pgTable(
  'calendar_feed',
  {
    id: primaryId(),
    tenantId: tenantId(),
    token: text('token').notNull(), // 32-char nanoid capability; unguessable; rotatable
    teacherId: text('teacher_id'), // forward-compat scope (MVP: null → whole-tenant feed, P3-7)
    label: text('label'), // e.g. "我的教学日历"
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    // H6: capability expiry. NULLABLE — existing rows (NULL) mean "never expires" (backward-compatible);
    // only newly issued/rotated tokens carry a TTL. NULL treated as infinite by the public route.
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('uq_calendar_feed_tenant_id').on(t.tenantId, t.id),
    // GLOBAL unique index (not tenant-prefixed): the public route looks up by token
    // alone with no tenant context. Intentional and safe — token maps to its own tenant.
    uniqueIndex('uq_calendar_feed_token').on(t.token),
    index('idx_calendar_feed_tenant').on(t.tenantId),
  ],
)
