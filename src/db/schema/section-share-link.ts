import { pgTable, text, timestamp, index, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { primaryId, tenantId, createdAt, updatedAt } from './_helpers'
import { classSection } from './course'

// 功能2: per-SECTION, revocable capability — the section mirror of share-link.ts (per-student). The
// public page (src/app/sec/[token]/page.tsx) resolves a token to this row and reads THAT section's
// lessons WITHOUT an AuthContext (via src/lib/share.ts), scoped only by the token-resolved row.
export const sectionShareLink = pgTable(
  'section_share_link',
  {
    id: primaryId(),
    tenantId: tenantId(),
    sectionId: text('section_id').notNull(),
    token: text('token').notNull(), // 32-char nanoid capability; unguessable; rotatable
    label: text('label'),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('uq_section_share_link_tenant_id').on(t.tenantId, t.id),
    // GLOBAL unique index (not tenant-prefixed): the public page looks up by token alone.
    uniqueIndex('uq_section_share_link_token').on(t.token),
    // One ACTIVE share per section (mirror share-link's per-student rule); revoked rows don't block re-issue.
    uniqueIndex('uq_section_share_link_active_section')
      .on(t.tenantId, t.sectionId)
      .where(sql`${t.revokedAt} is null`),
    foreignKey({
      columns: [t.tenantId, t.sectionId],
      foreignColumns: [classSection.tenantId, classSection.id],
      name: 'fk_section_share_link_section',
    }).onDelete('cascade'),
    index('idx_section_share_link_tenant_section').on(t.tenantId, t.sectionId),
  ],
)
