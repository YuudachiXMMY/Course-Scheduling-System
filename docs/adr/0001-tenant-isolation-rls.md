# ADR 0001 — Tenant isolation: application-layer enforcement (RLS deferred)

**Status:** Accepted (Phase 1)
**Date:** 2026-09-12
**Related review finding:** PR #1 / M1

## Context

Every domain table carries a `tenant_id` (= Better Auth `organizationId`) and a
`(tenant_id, id)` composite unique key, and all cross-table references use composite
`(tenant_id, <fk>)` foreign keys. Cross-tenant reference integrity is therefore
enforced by the database.

Single-table **read** isolation, however, is enforced only in the application layer:
every query goes through `forTenant(ctx)` (`src/db/tenant.ts`), which AND-scopes each
statement by `eq(tenant_id, ctx.tenantId)` and forces `tenant_id` on insert. There is
**no PostgreSQL Row Level Security (RLS) backstop**. A future raw `db.select().from(table)`
that bypasses `forTenant` (a new route, a report job, a script, or a bug) would read
across tenants with no database-level error.

## Decision

For Phase 1 we **accept** application-layer-only isolation and **defer RLS**.

Rationale:

- The `forTenant` wrapper is the single, mandatory data-access path today, and the
  tenant-isolation regression suite (`tests/tenant-isolation.test.ts`) covers IDOR read,
  cross-tenant update, and insert-smuggle.
- Correct RLS requires a per-request `SET LOCAL app.tenant_id` executed inside a
  transaction for **every** query, plus `FORCE ROW LEVEL SECURITY` (the app connects as
  the table owner, which otherwise bypasses policies). That is a connection-layer refactor
  of `forTenant` with real breakage risk, and is disproportionate for a skeleton with no
  production data yet.

## Guardrails (mandatory while RLS is deferred)

1. **All tenant-scoped data access MUST go through `forTenant(ctx)`.** Do not call
   `db.select/insert/update/delete` on a tenant table directly outside `src/db/tenant.ts`.
2. Auth/session tables (`user`, `session`, `member`, `organization`, …) are the documented
   exception — they are queried directly by the auth layer and are not tenant-scoped.
3. New tenant tables must expose `id` + `tenant_id` so they are compatible with `forTenant`.

## Revisit when

- Real customer data lands, **or**
- A code path needs raw DB access that can't go through `forTenant`, **or**
- We add a second connection role (e.g. an analytics/reporting user).

At that point, implement RLS keyed off `current_setting('app.tenant_id')` set per request
via `SET LOCAL`, and supersede this ADR.
