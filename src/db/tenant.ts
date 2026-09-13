import 'server-only'
import { and, eq, type SQL } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { db } from '@/db'
import type { AuthContext } from '@/auth/context'

type TenantTable = PgTable & { id: PgColumn; tenantId: PgColumn }

// tenantId comes ONLY from the verified AuthContext — never from request params/body.
export function forTenant(ctx: AuthContext) {
  const scope = (t: TenantTable) => eq(t.tenantId, ctx.tenantId)
  return {
    select<T extends TenantTable>(t: T, extra?: SQL) {
      const table = t as unknown as PgTable
      return db
        .select()
        .from(table)
        .where(extra ? and(scope(t), extra) : scope(t))
    },
    async findById<T extends TenantTable>(t: T, id: string) {
      const rows = await db
        .select()
        .from(t as unknown as PgTable)
        .where(and(scope(t), eq(t.id, id)))
        .limit(1)
      return rows[0] ?? null
    },
    insert<T extends TenantTable>(t: T, values: Record<string, unknown>) {
      return db
        .insert(t as unknown as PgTable)
        .values({ ...values, tenantId: ctx.tenantId }) // forces tenantId
        .returning()
    },
    update<T extends TenantTable>(t: T, id: string, values: Record<string, unknown>) {
      const { tenantId: _t, id: _id, ...safe } = values as Record<string, unknown>
      void _t
      void _id
      return db
        .update(t as unknown as PgTable)
        .set(safe)
        .where(and(scope(t), eq(t.id, id)))
        .returning()
    },
    delete<T extends TenantTable>(t: T, id: string) {
      return db
        .delete(t as unknown as PgTable)
        .where(and(scope(t), eq(t.id, id)))
        .returning()
    },
  }
}
