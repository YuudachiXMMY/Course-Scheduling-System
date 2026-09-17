import 'server-only'
import { and, count as countRows, eq, type SQL } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { db } from '@/db'
import type { AuthContext } from '@/auth/context'

type TenantTable = PgTable & { id: PgColumn; tenantId: PgColumn }

// tenantId comes ONLY from the verified AuthContext — never from request params/body.
//
// M1: this wrapper is the ONLY sanctioned path to tenant-scoped data. There is no RLS backstop yet
// (see docs/adr/0001-tenant-isolation-rls.md) — a raw db.select().from(tenantTable) elsewhere would
// silently cross tenants. Do not bypass forTenant() for tenant tables.
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
    // Tenant-scoped COUNT(*) — returns a scalar instead of loading rows into memory (hot paths like
    // the unread badge that only need a number). `extra` narrows within the tenant, never across it.
    async count<T extends TenantTable>(t: T, extra?: SQL): Promise<number> {
      const [row] = await db
        .select({ value: countRows() })
        .from(t as unknown as PgTable)
        .where(extra ? and(scope(t), extra) : scope(t))
      return row?.value ?? 0
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
    // Bulk tenant-scoped delete by an arbitrary condition (retention / cleanup jobs). Like delete()
    // the tenant scope is ALWAYS AND-ed in, so `extra` can only narrow WITHIN ctx.tenantId — it can
    // never reach another tenant's rows. `extra` is REQUIRED (a forgotten predicate can't become a
    // whole-table wipe), but note it bounds CROSS-tenant blast radius only: a tautological `extra`
    // (e.g. sql`true`) would still delete every row of this tenant, so callers must scope it themselves.
    deleteWhere<T extends TenantTable>(t: T, extra: SQL) {
      return db
        .delete(t as unknown as PgTable)
        .where(and(scope(t), extra))
        .returning()
    },
  }
}
