import { pgTable, text, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { primaryId, tenantId, createdAt, updatedAt } from './_helpers'

// Phase 7b: persisted Web Push subscriptions (one row per browser endpoint). Best-effort delivery
// target — the notification table is the reliable store. Both userId and the push endpoint are
// external identifiers, so this table carries NO foreign keys (mirrors portal_link's bare userId).
export const pushSubscription = pgTable(
  'push_subscription',
  {
    id: primaryId(),
    tenantId: tenantId(),
    userId: text('user_id').notNull(), // Better Auth user.id — bare text, NO FK (auth-owned)
    endpoint: text('endpoint').notNull(), // long push service URL — text, not varchar
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // SEC2/CR8: ownership + upsert key is (tenant, USER, endpoint). Was (tenant, endpoint) alone,
    // which let any same-tenant user take over / delete another user's row by submitting their
    // endpoint. Keying on userId means a caller's atomic onConflictDoUpdate can only ever match — and
    // therefore only ever mutate — their OWN row for an endpoint; a second user on a shared browser
    // gets a separate row instead of stealing the first user's.
    uniqueIndex('uq_push_sub_tenant_user_endpoint').on(t.tenantId, t.userId, t.endpoint),
    index('idx_push_sub_tenant_user').on(t.tenantId, t.userId), // "subscriptions for this user"
  ],
)
