import { text, timestamp } from 'drizzle-orm/pg-core'
import { nanoid } from 'nanoid'

// R3: text + nanoid PK — non-guessable, tenant-safe, type-identical to Better Auth ids.
export const primaryId = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => nanoid())

// tenant_id === Better Auth organizationId. Bare text (auth owns the organization table).
export const tenantId = () => text('tenant_id').notNull()

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
