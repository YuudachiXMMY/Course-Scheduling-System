import 'server-only'
import { and, count as countRows, eq, type SQL } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { db } from '@/db'
import type { AuthContext } from '@/auth/context'

type TenantTable = PgTable & { id: PgColumn; tenantId: PgColumn }

// B44: a chainable-and-awaitable view over a drizzle select builder that PRESERVES the row type.
// forTenant().select() must stay chainable (notification-core chains .orderBy().limit()) AND carry
// T['$inferSelect'] through those chains, so callers no longer hand-cast the result. Only the builder
// methods actually used today are exposed — chaining .groupBy/.leftJoin/.for on a scoped select is an
// intentional compile error (use raw db for those).
type TenantSelect<Row> = Promise<Row[]> & {
  orderBy(...cols: (SQL | PgColumn)[]): TenantSelect<Row>
  limit(n: number): TenantSelect<Row>
  offset(n: number): TenantSelect<Row>
}

// The subset of the drizzle client the tenant helpers (and the conflict/schedule cores) touch. Both the
// module `db` and a drizzle transaction handle `tx` satisfy it, so a caller inside db.transaction(tx => …)
// can pass `tx` to join the same transaction. Exported so conflict.ts / schedule-core.ts / schedule/data.ts
// share this one definition instead of each re-inlining the same Pick<…>.
export type TenantExecutor = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'>

// tenantId comes ONLY from the verified AuthContext — never from request params/body.
//
// M1: this wrapper is the ONLY sanctioned path to tenant-scoped data. There is no RLS backstop yet
// (see docs/adr/0001-tenant-isolation-rls.md) — a raw db.select().from(tenantTable) elsewhere would
// silently cross tenants. Do not bypass forTenant() for tenant tables.
//
// H7: optional `exec` executor. Defaults to the module `db` (zero change for the ~170 existing callers),
// but a caller inside db.transaction(tx => …) can pass `tx` so its scoped reads/writes join that ONE
// transaction — letting reschedule's claim+move commit or roll back atomically. Only the query-builder
// methods forTenant uses are required, and both `db` and a drizzle `tx` satisfy them.
export function forTenant(ctx: AuthContext, exec: TenantExecutor = db) {
  const scope = (t: TenantTable) => eq(t.tenantId, ctx.tenantId)
  return {
    select<T extends TenantTable>(t: T, extra?: SQL): TenantSelect<T['$inferSelect']> {
      const table = t as unknown as PgTable
      return exec
        .select()
        .from(table)
        .where(extra ? and(scope(t), extra) : scope(t)) as unknown as TenantSelect<
        T['$inferSelect']
      >
    },
    // Tenant-scoped COUNT(*) — returns a scalar instead of loading rows into memory (hot paths like
    // the unread badge that only need a number). `extra` narrows within the tenant, never across it.
    async count<T extends TenantTable>(t: T, extra?: SQL): Promise<number> {
      const [row] = await exec
        .select({ value: countRows() })
        .from(t as unknown as PgTable)
        .where(extra ? and(scope(t), extra) : scope(t))
      return row?.value ?? 0
    },
    async findById<T extends TenantTable>(t: T, id: string): Promise<T['$inferSelect'] | null> {
      const rows = await exec
        .select()
        .from(t as unknown as PgTable)
        .where(and(scope(t), eq(t.id, id)))
        .limit(1)
      return (rows[0] ?? null) as T['$inferSelect'] | null
    },
    insert<T extends TenantTable>(
      t: T,
      values: Record<string, unknown>,
    ): Promise<T['$inferSelect'][]> {
      return exec
        .insert(t as unknown as PgTable)
        .values({ ...values, tenantId: ctx.tenantId }) // forces tenantId
        .returning() as unknown as Promise<T['$inferSelect'][]>
    },
    update<T extends TenantTable>(
      t: T,
      id: string,
      values: Record<string, unknown>,
    ): Promise<T['$inferSelect'][]> {
      const { tenantId: _t, id: _id, ...safe } = values as Record<string, unknown>
      void _t
      void _id
      return exec
        .update(t as unknown as PgTable)
        .set(safe)
        .where(and(scope(t), eq(t.id, id)))
        .returning() as unknown as Promise<T['$inferSelect'][]>
    },
    // S0 (B19/B20): conditional tenant-scoped update — like update() but AND-s an extra predicate into
    // the WHERE so the row changes ONLY if it still matches (optimistic compare-and-set). A single
    // UPDATE statement re-evaluates its WHERE after taking the row lock, so two concurrent callers
    // serialise: the loser's predicate (e.g. status='pending') no longer holds and it gets [] back.
    // Callers treat 0 returned rows as a lost race / conflict. tenantId + id are always AND-ed in.
    updateWhere<T extends TenantTable>(
      t: T,
      id: string,
      extra: SQL,
      values: Record<string, unknown>,
    ): Promise<T['$inferSelect'][]> {
      const { tenantId: _t, id: _id, ...safe } = values as Record<string, unknown>
      void _t
      void _id
      return exec
        .update(t as unknown as PgTable)
        .set(safe)
        .where(and(scope(t), eq(t.id, id), extra))
        .returning() as unknown as Promise<T['$inferSelect'][]>
    },
    // Bulk tenant-scoped UPDATE by an arbitrary condition — the update analogue of deleteWhere, and the
    // batch counterpart of update()/updateWhere() (which touch a single id). Collapses a select-then-
    // per-row-update loop into ONE statement (PERF2/PERF4). Same isolation invariants as deleteWhere:
    // scope(t) is ALWAYS AND-ed in so `extra` can only narrow WITHIN ctx.tenantId, `extra` is REQUIRED,
    // and tenantId/id are stripped from `values` so the write can never move a row across tenants or
    // rewrite its id. Returns every affected row.
    updateWhereMany<T extends TenantTable>(
      t: T,
      extra: SQL,
      values: Record<string, unknown>,
    ): Promise<T['$inferSelect'][]> {
      const { tenantId: _t, id: _id, ...safe } = values as Record<string, unknown>
      void _t
      void _id
      return exec
        .update(t as unknown as PgTable)
        .set(safe)
        .where(and(scope(t), extra))
        .returning() as unknown as Promise<T['$inferSelect'][]>
    },
    delete<T extends TenantTable>(t: T, id: string): Promise<T['$inferSelect'][]> {
      return exec
        .delete(t as unknown as PgTable)
        .where(and(scope(t), eq(t.id, id)))
        .returning() as unknown as Promise<T['$inferSelect'][]>
    },
    // Bulk tenant-scoped delete by an arbitrary condition (retention / cleanup jobs). Like delete()
    // the tenant scope is ALWAYS AND-ed in, so `extra` can only narrow WITHIN ctx.tenantId — it can
    // never reach another tenant's rows. `extra` is REQUIRED (a forgotten predicate can't become a
    // whole-table wipe), but note it bounds CROSS-tenant blast radius only: a tautological `extra`
    // (e.g. sql`true`) would still delete every row of this tenant, so callers must scope it themselves.
    deleteWhere<T extends TenantTable>(t: T, extra: SQL): Promise<T['$inferSelect'][]> {
      return exec
        .delete(t as unknown as PgTable)
        .where(and(scope(t), extra))
        .returning() as unknown as Promise<T['$inferSelect'][]>
    },
  }
}
