# Plan: Phase 7c — MCP OAuth 2.1 (Better Auth `mcp` plugin)

## Summary
Upgrade the Claude MCP connector from a single static bearer token + fixed env principal to real per-user **OAuth 2.1**. The app becomes both the **OAuth 2.1 Authorization Server** (via Better Auth's `@better-auth/mcp` plugin) and the **MCP Resource Server**. Each MCP request now carries a JWT access token whose `sub` is a real Better Auth `userId`; the token is verified against `/jwks` (signature + issuer + **audience**), and the resolved principal is threaded into the existing tool stack via `AsyncLocalStorage` so the 8 tools stay byte-identical and every call still runs `requirePermission` + `forTenant(ctx)`.

## User Story
As the **tutor (and future assistants)**, I want to connect Claude to my scheduler by logging in with my own account (OAuth), instead of pasting one shared bearer token, so that MCP calls act as *me* (my tenant, my role) with per-user, revocable, audit-able access — and multiple users can each connect safely.

## Problem → Solution
**Current**: `withMcpAuth` compares one shared `MCP_BEARER_TOKEN` (constant-time) and `resolveMcpAuthContext()` **ignores the token**, reading a fixed `MCP_USER_ID`/`MCP_ORG_ID` env principal. One token = one hardcoded identity; no per-user auth, no revocation, no multi-user.
**Desired**: Better Auth issues per-user OAuth 2.1 access tokens (authorization-code + PKCE). `requireMcpAuth` validates each token (sig/iss/**aud**/exp) against our own `/jwks` and emits the RFC 9728 `WWW-Authenticate` challenge that lets Claude self-discover the AS. The verified `sub` (= our `userId`) + the org claim drive `mcpAuthContextFor(userId, tenantId)`, which re-derives role from the live `member` row. One identity system, Postgres remains the single source of truth.

## Metadata
- **Complexity**: **Large** (new deps + schema migration + route rewrite + discovery routes + consent page + seed script + tests + ADR; ~12 files)
- **Source PRD**: `.claude/PRPs/prds/course-scheduling-system.prd.md`
- **PRD Phase**: 7c — MCP OAuth 2.1 (depends on Phase 6 + 7a, both `complete`)
- **Estimated Files**: ~12 (2 new deps, 2 rewritten, ~7 new, ~3 edited)

> **⚠️ Deliberate deviation from the PRD (approved by the user 2026-09-15).** The PRD's Decisions Log and Phase 7c scope name **WorkOS AuthKit** as the OAuth 2.1 provider. Codebase reality — Better Auth is the *sole* identity source, and all authorization keys on Better Auth `userId` + `organizationId` (`member` table) — makes WorkOS require a second identity store bridged to ours (email match or a `workosUserId` column + provisioning sync), contradicting the PRD's own "唯一真相源永远是自有 Postgres" principle and enlarging the H-impact cross-tenant-leak surface. Better Auth's `mcp` plugin issues tokens whose `sub` **is** our `userId`, mapping directly onto the existing `AuthContext`. See `docs/adr/0002-mcp-oauth-better-auth.md` (Task 12).

---

## UX Design

This is mostly an internal/protocol change, but the **tutor-facing connect flow changes** and a **consent screen** is introduced.

### Before
```
┌─────────────────────────────────────────────────────────┐
│ Tutor: generate MCP_BEARER_TOKEN (openssl rand)          │
│  → set MCP_BEARER_TOKEN / MCP_USER_ID / MCP_ORG_ID in    │
│    Coolify env                                            │
│  → in Claude: add connector  /api/mcp                     │
│    + header  Authorization: Bearer <token>               │
│  → all calls act as the ONE hardcoded env user/org        │
└─────────────────────────────────────────────────────────┘
```

### After
```
┌─────────────────────────────────────────────────────────┐
│ Tutor: in Claude, add connector URL  /api/mcp  (no token)│
│  → Claude gets 401 + WWW-Authenticate (RFC 9728)          │
│  → Claude discovers AS, registers (pre-seeded/ DCR)       │
│  → Claude opens our /login  → tutor logs in with account  │
│  → (trusted client: skipConsent; else /consent approve)   │
│  → Claude receives a per-user access token (PKCE)         │
│  → every call acts as THAT logged-in user's tenant+role;  │
│    revoke by signing out / disabling the OAuth client     │
└─────────────────────────────────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Connect Claude | Paste shared bearer | Log in via OAuth (browser) | Per-user identity |
| Principal | Fixed `MCP_USER_ID`/`MCP_ORG_ID` | Token `sub` = the logged-in `userId` | Multi-user |
| Consent | none | trusted client → skipped; else minimal `/consent` | Only new UI |
| Revocation | rotate one shared secret | sign out / disable OAuth client / delete token row | Granular |
| Per-tool authz | role via `requirePermission` (unchanged) | **identical** — role via `requirePermission` | Tools untouched |

---

## Mandatory Reading

Files that MUST be read before implementing (all paths repo-root-relative):

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/app/api/[transport]/route.ts` | 1-36 | The exact seam being rewritten (static bearer → `requireMcpAuth`) |
| P0 | `src/auth/mcp-context.ts` | 1-38 | `resolveMcpAuthContext` (env → ALS) + `mcpAuthContextFor` (KEEP verbatim) |
| P0 | `src/auth/auth.ts` | 1-78 | Where `jwt()` + `mcp()` plugins wire in; `nextCookies()` MUST stay last |
| P0 | `src/auth/context.ts` | 1-52 | `AuthContext`, `AuthError` codes, DB-role re-derivation pattern |
| P0 | `src/db/tenant.ts` | 1-56 | `forTenant(ctx)` — the only sanctioned tenant-scope path (unchanged) |
| P1 | `src/env.ts` | 1-42 | Env conventions; the `MCP_*` block to edit |
| P1 | `src/auth/authorize.ts` | 1-18 | `requirePermission` / `can` — per-tool RBAC (unchanged) |
| P1 | `src/auth/permissions.ts` | 1-83 | Role↔statement matrix (owner/teacher/assistant/parent/student) |
| P1 | `src/db/auth-schema.ts` | 1-179 | Better Auth tables; regenerated to add `oauth*` + `jwk` |
| P1 | `tests/mcp-tools.test.ts` | 1-54, 189-283 | Test harness (`captureTools`, `ctxFor`, mock `resolveMcpAuthContext`) |
| P2 | `src/mcp/register-tools.ts` | 34-91 | `runTool` error mapper + a representative tool (message edit only) |
| P2 | `src/app/api/health/route.ts` | all | `Response.json` route-handler shape (mirror for discovery routes) |
| P2 | `next.config.ts` | 1-42 | `output:'standalone'`, no middleware, no `webpack()`; route runtime rules |
| P2 | `docs/adr/0001-tenant-isolation-rls.md` | all | ADR format to mirror for 0002 |
| P2 | `scripts/migrate.ts` | all | Migration runner style (advisory lock) |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Better Auth 1.7 upgrade | https://www.better-auth.com/docs/guides/1-7-upgrade-guide | `mcp`/`oidcProvider` moved OUT of `better-auth/plugins` into `@better-auth/mcp` + `@better-auth/oauth-provider`; `oidcProvider`→`oauthProvider`; `withMcpAuth`→`requireMcpAuth`; `getMcpSession` removed; table `oauthApplication`→`oauthClient` |
| Better Auth MCP plugin | https://www.better-auth.com/docs/plugins/mcp | `mcp()` IS the OAuth/OIDC provider (cannot also add `oauthProvider()`); needs `jwt()`; `resource` required (audience-binds tokens); serves RFC 9728 |
| Better Auth OAuth provider | https://www.better-auth.com/docs/plugins/oauth-provider | `oauthProviderAuthServerMetadata(auth)` / `oauthProviderOpenIdConfigMetadata(auth)` route helpers; `auth.api.createOAuthClient`; `customAccessTokenClaims`; `skipConsent` client field; DCR flags |
| MCP Authorization spec 2025-06-18 | https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization | RS MUST publish RFC 9728 metadata; 401 MUST carry `WWW-Authenticate`; client MUST use PKCE; token `aud` MUST be validated (RFC 8707); DCR is SHOULD |
| RFC 9728 (protected-resource metadata) | https://datatracker.ietf.org/doc/html/rfc9728 | `.well-known/oauth-protected-resource` fields: `resource`, `authorization_servers`, `bearer_methods_supported`, `scopes_supported` |
| mcp-handler authorization | https://github.com/vercel/mcp-handler/blob/main/docs/AUTHORIZATION.md | `protectedResourceHandler({ authServerUrls, resourceUrl })` + `metadataCorsOptionsRequestHandler()`; v2 surfaces auth to tools as `ctx.http?.authInfo` (NOT the old 2nd-arg `extra`) |

### Version pins (verified against the 1.7.4 npm tarballs)
- `@better-auth/mcp@1.7.4` — deps `{ jose: ^6.1.3, @better-auth/oauth-provider: ^1.7.4 }`; peers `{ better-auth: ^1.7.4, @better-auth/core: ^1.7.4, better-call: 1.4.0 }`.
- Installed today: `better-auth 1.7.4` (`@better-auth/mcp` NOT yet installed). Keep all `@better-auth/*` on the **same 1.7.x**; pin exact versions ("stable-but-young" — renames landed in 1.7).

---

## Patterns to Mirror

Actual codebase snippets. New code must be indistinguishable from these.

### NAMING_CONVENTION / IMPORTS / server-only
```ts
// SOURCE: src/auth/mcp-context.ts:1-6 — every server module opens with 'server-only';
// imports are alias-absolute (@/...); node builtins use node: prefix.
import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { member } from '@/db/schema'
import { AuthError, type AuthContext } from '@/auth/context'
import { env } from '@/env'
```
- Path alias: `@/*` → `./src/*` (single alias; resolved in tests by `vite-tsconfig-paths`).
- File names: kebab-case `.ts` (`mcp-context.ts`, `schedule-core.ts`); route handlers are `route.ts`; App-Router dynamic segments are bracketed dirs (`[transport]`).

### ENV_PATTERN (optional + min-length; server block; `@/env` access)
```ts
// SOURCE: src/env.ts:13-19 — MCP vars are ALL .optional() so the app boots without MCP;
// min-length applies WHEN present. New OAuth vars follow this exact style with a Pxx tag.
    MCP_BEARER_TOKEN: z.string().min(32).optional(), // static bearer; generate: openssl rand -base64 48
    MCP_ORG_ID: z.string().min(1).optional(), // organizationId (=tenantId) the token acts as
    MCP_USER_ID: z.string().min(1).optional(), // user.id the token acts as (owner member row)
    MCP_RESOURCE_URL: z.url().optional(), // audience for withMcpAuth (anti confused-deputy)
```

### AUTHCONTEXT + DB-ROLE RE-DERIVATION (the property we must preserve)
```ts
// SOURCE: src/auth/mcp-context.ts:19-27 — KEEP THIS FUNCTION VERBATIM.
// Re-derives role from the live member row so a demoted/removed principal loses access immediately;
// isPlatformAdmin ALWAYS false — an MCP token must never get cross-tenant god-mode.
export async function mcpAuthContextFor(userId: string, tenantId: string): Promise<AuthContext> {
  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, tenantId), eq(member.userId, userId)))
    .limit(1)
  if (!m) throw new AuthError('NOT_A_MEMBER')
  return { userId, tenantId, role: m.role, isPlatformAdmin: false }
}
```

### ERROR_HANDLING — route handlers use Web `Response`; MCP tools use `runTool`
```ts
// SOURCE: src/app/api/health/route.ts:5 — JSON success. There is NO NextResponse in this repo.
return Response.json({ ok: true, ts: Date.now() }, { status: 200 })
```
```ts
// SOURCE: src/mcp/register-tools.ts:39-59 — central error→content mapper; every tool body runs inside it.
// AuthError branch surfaces the code to the model. NO_ACTIVE_ORG message MUST be updated (Task 5).
async function runTool(fn: () => Promise<ReturnType<typeof ok> | ReturnType<typeof fail>>) {
  try { return await fn() } catch (e) {
    if (e instanceof AuthError) {
      const msg = e.code === 'FORBIDDEN' ? '无权限执行该操作'
        : e.code === 'NO_ACTIVE_ORG' ? 'MCP 连接器未配置主体（请设置 MCP_ORG_ID / MCP_USER_ID）'
        : e.code === 'NOT_A_MEMBER' ? 'MCP 配置的用户不是该机构成员' : '认证失败'
      return fail(msg)
    }
    if (e instanceof ConflictError) return fail('时间冲突，无法保存')
    if (e instanceof z.ZodError) return fail(`参数校验失败：${e.issues.map((i) => i.message).join('；')}`)
    return fail(e instanceof Error ? e.message : '未知错误')
  }
}
```

### RBAC GATE (unchanged — tools keep calling this)
```ts
// SOURCE: src/auth/authorize.ts:14-17
export function requirePermission(ctx: AuthContext, permission: PermissionRequest): void {
  if (ctx.isPlatformAdmin) return
  if (!can(ctx.role, permission)) throw new AuthError('FORBIDDEN')
}
```

### DATA ACCESS (unchanged — tenantId only from verified ctx)
```ts
// SOURCE: src/db/tenant.ts:14-23 — the ONLY sanctioned tenant-scoped path.
export function forTenant(ctx: AuthContext) {
  const scope = (t: TenantTable) => eq(t.tenantId, ctx.tenantId)
  return {
    select<T extends TenantTable>(t: T, extra?: SQL) {
      const table = t as unknown as PgTable
      return db.select().from(table).where(extra ? and(scope(t), extra) : scope(t))
    }, /* findById / insert(forces tenantId) / update / delete ... */
  }
}
```

### PLUGIN WIRING (where new plugins go; order matters)
```ts
// SOURCE: src/auth/auth.ts:65-75 — nextCookies() is documented "R6: MUST be last".
// jwt() + mcp() go BEFORE nextCookies(), AFTER organization()/adminPlugin().
  plugins: [
    organization({ ac, roles: orgRoles, creatorRole: 'owner' }),
    adminPlugin({ ac: adminAc, roles: adminRoles, adminRoles: ['superadmin'], defaultRole: 'user' }),
    nextCookies(), // R6: MUST be last
  ],
```

### TEST_STRUCTURE (the exact seam an OAuth upgrade re-targets)
```ts
// SOURCE: tests/mcp-tools.test.ts:27-54 — partial-mock resolveMcpAuthContext (keep mcpAuthContextFor real);
// capture real tool handlers on a fake server; build AuthContext directly via ctxFor().
vi.mock('@/auth/mcp-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/mcp-context')>()),
  resolveMcpAuthContext: vi.fn(),
}))
const captureTools = (): Map<string, ToolHandler> => {
  const handlers = new Map<string, ToolHandler>()
  const fakeServer = { registerTool: (name: string, _spec: unknown, handler: unknown) => { handlers.set(name, handler as ToolHandler) } }
  registerCourseSchedulingTools(fakeServer as unknown as Parameters<typeof registerCourseSchedulingTools>[0])
  return handlers
}
const ctxFor = (tenantId: string, userId: string, role = 'owner'): AuthContext => ({ tenantId, userId, role, isPlatformAdmin: false })
```
- Tests live in top-level `/tests/` (NOT co-located). `server-only` is aliased to a stub (`tests/server-only-stub.ts`). DB-integration tests use a live Postgres (`DATABASE_URL` via `dotenv/config`), seed `organization/user/member` (Better Auth rows need explicit `createdAt`), and run an idempotent `cleanup()` in BOTH `beforeAll` and `afterAll` (children before parents). Command: `pnpm test` (`vitest run`).

### DISCOVERY METADATA (mcp-handler helper — already a dependency)
```ts
// SOURCE: mcp-handler docs (AUTHORIZATION.md). The .well-known route MUST stay public (no auth).
import { protectedResourceHandler, metadataCorsOptionsRequestHandler } from 'mcp-handler'
const handler = protectedResourceHandler({ authServerUrls: ['https://<issuer>'], resourceUrl: '<MCP resource>' })
const corsHandler = metadataCorsOptionsRequestHandler()
export { handler as GET, corsHandler as OPTIONS }
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `package.json` / lockfile | UPDATE | Add `@better-auth/mcp@1.7.4` (pulls `@better-auth/oauth-provider`, `jose`) + a `mcp:seed-client` script |
| `src/auth/auth.ts` | UPDATE | Add `jwt()` + `mcp({...})` plugins with `customAccessTokenClaims` (org claim) |
| `src/db/auth-schema.ts` | UPDATE (generated) | Regenerate to add `oauthClient/oauthAccessToken/oauthRefreshToken/oauthConsent/oauthClientAssertion/oauthResource/oauthClientResource` + `jwk` |
| `drizzle/0008_*.sql` (+ `meta`) | CREATE (generated) | Drizzle migration for the new tables |
| `src/auth/mcp-als.ts` | CREATE | `AsyncLocalStorage` per-request MCP principal store + `runWithMcpPrincipal` / `getMcpPrincipal` |
| `src/auth/mcp-context.ts` | UPDATE | `resolveMcpAuthContext()` reads principal from ALS (not env) → `mcpAuthContextFor` |
| `src/app/api/[transport]/route.ts` | UPDATE (rewrite) | Replace static bearer + `withMcpAuth` with `requireMcpAuth(auth, …)` + ALS wrap |
| `src/app/.well-known/oauth-protected-resource/route.ts` | CREATE | RFC 9728 metadata at root (public) |
| `src/app/.well-known/oauth-authorization-server/route.ts` | CREATE | RFC 8414 metadata at root (re-export helper) |
| `src/app/.well-known/openid-configuration/route.ts` | CREATE | OIDC discovery at root (re-export helper) |
| `src/app/consent/page.tsx` | CREATE | Minimal consent page (config-required; bypassed for `skipConsent` trusted clients) |
| `scripts/seed-mcp-client.ts` | CREATE | Pre-register the Claude client (`auth.api.createOAuthClient`, `skipConsent: true`) |
| `src/env.ts` | UPDATE | Keep/repurpose `MCP_RESOURCE_URL` as the OAuth `resource`; retire `MCP_BEARER_TOKEN`/`MCP_USER_ID`/`MCP_ORG_ID` |
| `src/mcp/register-tools.ts` | UPDATE | Fix the `NO_ACTIVE_ORG` message string in `runTool` (env text is obsolete) |
| `tests/mcp-oauth.test.ts` | CREATE | ALS→ctx mapping, org-claim resolver, discovery-route shape |
| `tests/mcp-tools.test.ts` | UPDATE | Reuse; wrap direct handler calls in `mcpPrincipalStore.run(...)` where they hit `resolveMcpAuthContext` (or keep the mock) |
| `.env.example` | UPDATE | Document `MCP_RESOURCE_URL` (+ note removed vars) |
| `docs/adr/0002-mcp-oauth-better-auth.md` | CREATE | Record the WorkOS→Better-Auth decision reversal |

## NOT Building
- **WorkOS AuthKit / any external IdP** — rejected (see ADR 0002).
- **A full-featured consent UI** — trusted client uses `skipConsent: true`; ship only a minimal functional `/consent` page. Rich consent management is out of scope.
- **Open Dynamic Client Registration in production** — DCR flags stay `false`; pre-register the Claude client. (DCR documented as an optional toggle only.)
- **Scope-based fine-grained authz** — per-tool authorization stays **role-based** via `requirePermission` (unchanged). OAuth scopes are advertised for hygiene, not used to gate tools.
- **Multi-org selection per user** — assume one `member` row per user (matches the `session.create.before` hook). Multi-org picker is deferred.
- **DPoP / mTLS / token binding beyond audience** — Bearer + audience validation only for MVP.
- **Removing/replacing the `mcp-handler` transport** — keep `createMcpHandler`; only its auth wrapper changes.
- **Making the confirmation store multi-instance** (`src/lib/mcp-confirm.ts` stays an in-process `Map`; single-VPS deploy — unchanged from Phase 6).
- **Reminders, Google sync, payments** (7b/7d/7e) — separate phases.

---

## Step-by-Step Tasks

### Task 1: Add the Better Auth MCP dependency
- **ACTION**: Install `@better-auth/mcp@1.7.4` (brings `@better-auth/oauth-provider@^1.7.4`, `jose@^6.1.3`).
- **IMPLEMENT**: `pnpm add @better-auth/mcp@1.7.4`. Confirm `@better-auth/core` resolves to `1.7.4` (peer) and `better-call` to `1.4.0`. Add a package script: `"mcp:seed-client": "tsx scripts/seed-mcp-client.ts"`.
- **MIRROR**: Existing pinned-version style in `package.json` (e.g. `better-auth: "1.7.4"` exact, `@better-auth/drizzle-adapter: "1.7.4"`). Pin `@better-auth/mcp` exact too.
- **IMPORTS**: n/a (dependency).
- **GOTCHA**: `mcp`/`oauthProvider` are NOT in `better-auth/plugins` on 1.7.x — any `import { mcp } from 'better-auth/plugins'` tutorial is stale and will fail to resolve. `jwt` IS still in `better-auth/plugins`.
- **VALIDATE**: `pnpm ls @better-auth/mcp @better-auth/oauth-provider @better-auth/core better-auth better-call` shows all `@better-auth/*` on 1.7.x, `better-call 1.4.0`. `pnpm typecheck` still passes (no usage yet).

### Task 2: Wire `jwt()` + `mcp()` into the Better Auth server
- **ACTION**: Add the `jwt()` and `mcp()` plugins to `src/auth/auth.ts`, injecting the org claim into access tokens.
- **IMPLEMENT**:
  - `import { organization, admin as adminPlugin, jwt } from 'better-auth/plugins'` (add `jwt`).
  - `import { mcp } from '@better-auth/mcp'`.
  - In `plugins: [...]`, insert **before** `nextCookies()` (which must stay last), **after** `organization(...)`/`adminPlugin(...)`:
    ```ts
    jwt(),
    mcp({
      loginPage: '/login',
      consentPage: '/consent',
      resource: env.MCP_RESOURCE_URL ?? `${env.NEXT_PUBLIC_APP_URL}/api/mcp`,
      scopes: ['openid', 'profile', 'offline_access', 'schedule:read', 'schedule:write'],
      customAccessTokenClaims: async ({ user }) => {
        if (!user) return {}
        // Mirror the session.create.before hook: a user's tenant is their (single) member row's org.
        const [m] = await db
          .select({ organizationId: member.organizationId })
          .from(member)
          .where(eq(member.userId, user.id))
          .limit(1)
        return m?.organizationId ? { [MCP_ORG_CLAIM]: m.organizationId } : {}
      },
    }),
    ```
  - Define and export a stable namespaced claim constant (reuse it in the route/ALS): `export const MCP_ORG_CLAIM = 'https://course-scheduler/org'` (put it in `src/auth/mcp-als.ts` from Task 4, or a small shared const module, and import it here).
- **MIRROR**: `src/auth/auth.ts:65-75` plugin array; `src/auth/context.ts:34-38` / `src/auth/auth.ts:54-60` member-row lookup for `organizationId`.
- **IMPORTS**: `jwt` from `better-auth/plugins`; `mcp` from `@better-auth/mcp`; `db`, `member`, `env` already imported in `auth.ts` (verify `member` + `env` imports exist — `member` is imported at `auth.ts:8`; add `env` import from `@/env` if absent, else use `process.env.NEXT_PUBLIC_APP_URL`).
- **GOTCHA**:
  - `mcp()` **IS** the OAuth/OIDC provider — do NOT also add `oauthProvider()`/`oidcProvider()` (throws/conflicts).
  - `jwt()` is REQUIRED by `mcp()` (stable signing keys + `/jwks`); it adds a `jwk` table.
  - `resource` MUST be an HTTPS URL in prod (loopback HTTP allowed in dev), no query/fragment/credentials, and MUST equal the `resource` passed to `requireMcpAuth` (Task 6).
  - Namespace custom claims with a URI (JWT best practice; required for ID tokens). Keep the constant identical everywhere.
  - `env.ts` imports `env` — but `auth.ts` currently reads `process.env.BETTER_AUTH_URL` directly (lines 12-13). Prefer `env` for the new value; if importing `@/env` into `auth.ts` causes a boot-order concern, fall back to `process.env.NEXT_PUBLIC_APP_URL`.
- **VALIDATE**: `pnpm typecheck`. `pnpm dev` boots without plugin-conflict errors. `curl -s localhost:3000/api/auth/.well-known/oauth-authorization-server | jq` returns issuer/endpoints (proves the provider is live).

### Task 3: Regenerate the auth schema + create the Drizzle migration
- **ACTION**: Regenerate `src/db/auth-schema.ts` to include the new plugin tables, then generate + apply a Drizzle migration.
- **IMPLEMENT**:
  1. `pnpm auth:generate` (existing script → `npx --yes auth@latest generate --config ./src/auth/auth.ts --output ./src/db/auth-schema.ts`). Confirm the output now defines `oauthClient`, `oauthAccessToken`, `oauthRefreshToken`, `oauthConsent`, `oauthClientAssertion`, `oauthResource`, `oauthClientResource`, and `jwk`.
  2. `pnpm db:generate` (drizzle-kit) → new `drizzle/0008_*.sql`.
  3. Review the SQL, then `pnpm db:migrate` against the dev DB.
- **MIRROR**: The generation + migrate flow already established (`package.json` `auth:generate`/`db:generate`/`db:migrate`; `scripts/migrate.ts` advisory-lock runner). The schema barrel `src/db/schema/index.ts` already ends with `export * from '../auth-schema'`, so new tables are auto-exported.
- **IMPORTS**: n/a.
- **GOTCHA**:
  - If `pnpm auth:generate` (the `auth@latest` CLI) does **not** emit the `@better-auth/mcp` tables (CLI/plugin-detection mismatch), fall back to `npx @better-auth/cli@1.7.4 generate --config ./src/auth/auth.ts --output ./src/db/auth-schema.ts`. **Verify the 8 tables are present before proceeding** — this is the one CLI-behavior unknown.
  - `drizzle.config.ts` uses `casing: 'snake_case'` — generated column names must match; don't hand-edit casing.
  - Migrations use an advisory lock (`scripts/migrate.ts`); safe to run once.
- **VALIDATE**: `git diff src/db/auth-schema.ts` shows the 8 new tables. `pnpm db:migrate` prints `[migrate] done`. In `psql`: `\dt` lists `oauth_client`, `oauth_access_token`, `jwk`, etc. `pnpm typecheck`.

### Task 4: Add the AsyncLocalStorage principal store
- **ACTION**: Create `src/auth/mcp-als.ts` — a per-request store carrying the verified `{ userId, tenantId }` from the OAuth token into the tool layer, plus the shared org-claim constant.
- **IMPLEMENT**:
  ```ts
  import 'server-only'
  import { AsyncLocalStorage } from 'node:async_hooks'

  // The namespaced access-token claim that carries the authorized organization (=tenantId).
  // MUST match the claim injected by mcp({ customAccessTokenClaims }) in src/auth/auth.ts.
  export const MCP_ORG_CLAIM = 'https://course-scheduler/org'

  export interface McpPrincipal { userId: string; tenantId: string }

  // Per-request principal derived from the verified OAuth JWT. Empty outside an MCP request.
  const store = new AsyncLocalStorage<McpPrincipal>()

  export function runWithMcpPrincipal<T>(p: McpPrincipal, fn: () => Promise<T>): Promise<T> {
    return store.run(p, fn)
  }
  export function getMcpPrincipal(): McpPrincipal | undefined {
    return store.getStore()
  }
  ```
- **MIRROR**: `src/lib/mcp-confirm.ts` (module-scope singleton with a leading `import 'server-only'` and an explanatory comment about statelessness). `node:` prefix for builtins (`src/app/api/[transport]/route.ts:3`).
- **IMPORTS**: `AsyncLocalStorage` from `node:async_hooks`.
- **GOTCHA**: `nodejs` runtime is required for `async_hooks` — the MCP route already sets `export const runtime = 'nodejs'`. Import `MCP_ORG_CLAIM` from here into `auth.ts` (Task 2) so the constant is defined once.
- **VALIDATE**: `pnpm typecheck`. Unit test in Task 11 exercises run/get.

### Task 5: Repoint `resolveMcpAuthContext` from env to the ALS principal
- **ACTION**: Rewrite `resolveMcpAuthContext()` in `src/auth/mcp-context.ts` to read the per-request principal from `getMcpPrincipal()` instead of `env.MCP_USER_ID`/`env.MCP_ORG_ID`. Keep `mcpAuthContextFor` byte-identical.
- **IMPLEMENT**:
  ```ts
  import { getMcpPrincipal } from '@/auth/mcp-als'
  // ...
  export async function resolveMcpAuthContext(): Promise<AuthContext> {
    const p = getMcpPrincipal()
    if (!p?.userId || !p?.tenantId) {
      // requireMcpAuth gates the route, so this is defensive: a tool ran outside an authed MCP request.
      throw new AuthError('NO_ACTIVE_ORG')
    }
    return mcpAuthContextFor(p.userId, p.tenantId)
  }
  ```
  Remove the `import { env } from '@/env'` line if it becomes unused. Update the header comment (P6-1 → P7c) to describe "principal from the verified OAuth token via ALS".
- **MIRROR**: The current function's shape (`src/auth/mcp-context.ts:29-37`) and its "alternate PRINCIPAL SOURCE, not a raw-db exception" comment intent — the new source is the OAuth token, everything downstream (`requirePermission` + `forTenant`) is unchanged.
- **IMPORTS**: `getMcpPrincipal` from `@/auth/mcp-als`.
- **GOTCHA**: `mcpAuthContextFor` still throws `AuthError('NOT_A_MEMBER')` if the token's user isn't a member of the claimed org — this preserves the "demoted/removed principal loses access immediately" property and is the last-line tenant guard. Do NOT trust the org claim without this member-row check.
- **ALSO (Task 5b)**: In `src/mcp/register-tools.ts:47-48`, update the `NO_ACTIVE_ORG` message — the old text names the removed env vars. Change to e.g. `'MCP 请求缺少已验证主体（OAuth 令牌无效或未携带机构信息）'`.
- **VALIDATE**: `pnpm typecheck`. Task 11 test: within `runWithMcpPrincipal({userId,tenantId}, () => resolveMcpAuthContext())` returns the ctx; outside → `AuthError`.

### Task 6: Rewrite the MCP transport route with `requireMcpAuth`
- **ACTION**: Replace the static-bearer `verifyToken` + `mcp-handler` `withMcpAuth` in `src/app/api/[transport]/route.ts` with Better Auth's `requireMcpAuth`, wrapping tool dispatch in the ALS principal.
- **IMPLEMENT**:
  ```ts
  import { createMcpHandler } from 'mcp-handler'
  import { requireMcpAuth } from '@better-auth/mcp'
  import { auth } from '@/auth/auth'
  import { registerCourseSchedulingTools } from '@/mcp/register-tools'
  import { runWithMcpPrincipal, MCP_ORG_CLAIM } from '@/auth/mcp-als'
  import { env } from '@/env'

  export const runtime = 'nodejs'
  export const dynamic = 'force-dynamic'
  export const maxDuration = 60

  const handler = createMcpHandler((server) => registerCourseSchedulingTools(server), {
    serverInfo: { name: 'course-scheduling-mcp', version: '1.0.0' },
  })

  // requireMcpAuth verifies the JWT (sig / iss / aud / exp) against /jwks and, on failure, returns a
  // 401 with the RFC 9728 WWW-Authenticate challenge that lets Claude self-discover the AS. The verified
  // claims carry sub (= our userId) and the namespaced org claim; we stash them in ALS so the 8 tools —
  // which call resolveMcpAuthContext() with no args — resolve the per-request principal unchanged.
  const authed = requireMcpAuth(
    auth,
    (request, claims) => {
      const userId = String(claims.sub ?? '')
      const tenantId = String((claims as Record<string, unknown>)[MCP_ORG_CLAIM] ?? '')
      return runWithMcpPrincipal({ userId, tenantId }, () => handler(request))
    },
    {
      resource: env.MCP_RESOURCE_URL ?? `${env.NEXT_PUBLIC_APP_URL}/api/mcp`, // MUST equal mcp({ resource })
      // Authz stays ROLE-based inside each tool (requirePermission). Keep scope gate coarse/empty.
      requiredScopes: [],
    },
  )

  export { authed as GET, authed as POST }
  ```
- **MIRROR**: Kept exports (`runtime`/`dynamic`/`maxDuration`, GET+POST) from the current route (`route.ts:9-11,35`). `createMcpHandler(...)` call is unchanged from `route.ts:13-15`.
- **IMPORTS**: `requireMcpAuth` from `@better-auth/mcp`; `auth` from `@/auth/auth`; `runWithMcpPrincipal`, `MCP_ORG_CLAIM` from `@/auth/mcp-als`.
- **GOTCHA**:
  - `mcp-handler` does NOT forward an outer wrapper's `AuthInfo` into tool `extra`/`ctx` — hence ALS. Do not try to pass `claims` as a tool arg.
  - `resource` here MUST byte-match `mcp({ resource })` (Task 2) or audience validation fails every request.
  - Keep the `[transport]` dir (vestigial but harmless); clients still POST to `/api/mcp`.
  - Confirm the `claims` param type (jose `JWTPayload`); `claims.sub` is `string | undefined` — coerce/guard.
  - Delete the now-unused `timingSafeEqual`/`AuthInfo`/`env.MCP_BEARER_TOKEN` imports.
- **VALIDATE**: `pnpm typecheck`. `curl -si localhost:3000/api/mcp -X POST -H 'content-type: application/json' -d '{}'` returns **401** with a `WWW-Authenticate: Bearer ... resource_metadata="..."` header (proves the challenge fires).

### Task 7: Add root `.well-known` discovery routes (public)
- **ACTION**: Expose OAuth/OIDC discovery at the site root (Better Auth serves them under `/api/auth/.well-known/…`, but MCP clients look at root).
- **IMPLEMENT**:
  - `src/app/.well-known/oauth-authorization-server/route.ts`:
    ```ts
    import { auth } from '@/auth/auth'
    import { oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider'
    export const runtime = 'nodejs'
    export const GET = oauthProviderAuthServerMetadata(auth)
    ```
  - `src/app/.well-known/openid-configuration/route.ts`:
    ```ts
    import { auth } from '@/auth/auth'
    import { oauthProviderOpenIdConfigMetadata } from '@better-auth/oauth-provider'
    export const runtime = 'nodejs'
    export const GET = oauthProviderOpenIdConfigMetadata(auth)
    ```
  - `src/app/.well-known/oauth-protected-resource/route.ts` (RFC 9728, keep public + CORS):
    ```ts
    import { protectedResourceHandler, metadataCorsOptionsRequestHandler } from 'mcp-handler'
    import { env } from '@/env'
    export const runtime = 'nodejs'
    const resourceUrl = env.MCP_RESOURCE_URL ?? `${env.NEXT_PUBLIC_APP_URL}/api/mcp`
    const issuer = env.BETTER_AUTH_URL
    export const GET = protectedResourceHandler({ authServerUrls: [issuer], resourceUrl })
    export const OPTIONS = metadataCorsOptionsRequestHandler()
    ```
- **MIRROR**: `src/app/api/health/route.ts` for a minimal route; discovery-metadata snippet from mcp-handler docs (Patterns → DISCOVERY METADATA). `runtime='nodejs'` like every dynamic route.
- **IMPORTS**: helpers from `@better-auth/oauth-provider` and `mcp-handler`; `auth` from `@/auth/auth`; `env` from `@/env`.
- **GOTCHA**:
  - These routes MUST stay public — never behind auth/middleware (there is no `middleware.ts`; keep it that way).
  - `requireMcpAuth`'s 401 advertises a `resource_metadata` URL. **Verify the advertised path is actually served** — if it points at `/api/auth/.well-known/oauth-protected-resource`, that Better-Auth-served doc already exists and the root copy is belt-and-suspenders; if it points at root, the Task 7 route satisfies it. Confirm the full discovery chain end-to-end (Manual Validation).
  - `next.config.ts` has no `rewrites`; `.well-known` resolves as normal App-Router routes.
- **VALIDATE**: `curl -s localhost:3000/.well-known/oauth-authorization-server | jq '.issuer, .authorization_endpoint, .token_endpoint, .jwks_uri'` all present. `curl -s localhost:3000/.well-known/oauth-protected-resource | jq '.resource, .authorization_servers'` present. `curl -sI -X OPTIONS localhost:3000/.well-known/oauth-protected-resource` returns CORS headers.

### Task 8: Add a minimal `/consent` page
- **ACTION**: Create `src/app/consent/page.tsx` — required by `mcp({ consentPage })`. Primary path bypasses it (trusted client `skipConsent`); build a minimal functional approve/deny for non-trusted clients.
- **IMPLEMENT**: A client (or server) page that reads the OAuth request params from the query string (`client_id`, `scope`, `redirect_uri`, etc.), shows the requesting client + scopes in Chinese, and posts approval/denial to Better Auth's consent endpoint. Use the Better Auth client (`src/auth/client.ts`) OAuth consent method (verify exact name — see GOTCHA). Style with Tailwind, matching `src/app/(auth)/login/page.tsx`.
- **MIRROR**: `src/app/(auth)/login/page.tsx` (page structure, Tailwind classes, Chinese copy, `authClient` usage from `src/auth/client.ts`).
- **IMPORTS**: `authClient` from `@/auth/client`; React.
- **GOTCHA**:
  - **Doc-lookup needed for the exact consent API** (`authClient.oauth2.consent(...)` / an `auth.api` consent method). This is the one part not fully pinned from the tarball review. **Mitigation / primary path**: pre-register the Claude client with `skipConsent: true` (Task 9) so this page is never rendered for the known connector. Ship a minimal but correct page for completeness; do the doc-lookup (`better-auth.com/docs/plugins/oauth-provider`) if a full consent UX is needed for untrusted clients.
  - The page must be public (unauthenticated users hitting it get redirected to `/login` by the OAuth flow, which Better Auth handles via `loginPage`).
- **VALIDATE**: `pnpm typecheck` + `pnpm build`. Manual: with a non-skipConsent client, the authorize step renders `/consent`; approving returns to the client with a code. (For the seeded skipConsent client, confirm `/consent` is skipped.)

### Task 9: Pre-register the Claude MCP client (seed script)
- **ACTION**: Create `scripts/seed-mcp-client.ts` to register a trusted OAuth client for Claude via `auth.api.createOAuthClient`, with `skipConsent: true`.
- **IMPLEMENT**:
  ```ts
  import 'dotenv/config'
  import { auth } from '@/auth/auth'

  async function main() {
    const res = await auth.api.createOAuthClient({
      body: {
        name: 'Claude Connector',
        redirect_uris: [
          // TODO: confirm Claude's actual callback URI(s) from Anthropic connector docs before running.
          'https://claude.ai/api/mcp/auth_callback',
        ],
        token_endpoint_auth_method: 'none', // public client + PKCE
        skipConsent: true,
        // scopes: ['openid', 'profile', 'offline_access', 'schedule:read', 'schedule:write'],
      },
    })
    console.log('[seed-mcp-client] created client:', res)
  }
  main().then(() => process.exit(0), (e) => { console.error('[seed-mcp-client] FAILED:', e); process.exit(1) })
  ```
  Run with the added script `pnpm mcp:seed-client` (needs `DATABASE_URL`; `tsx` + `dotenv/config`, like `scripts/migrate.ts`).
- **MIRROR**: `scripts/migrate.ts` (dotenv import, `main().then(ok, err→exit(1))`, `[tag]` console prefix).
- **IMPORTS**: `auth` from `@/auth/auth`.
- **GOTCHA**:
  - **Confirm Claude's real redirect URI(s)** before seeding — a wrong `redirect_uri` blocks the flow. (Claude Desktop/Code/.ai may differ.)
  - The 1.7.4 server API is `auth.api.createOAuthClient` (NOT the removed `registerOAuthApplication`). Verify the exact `body` field names against `@better-auth/oauth-provider` types (`redirect_uris` vs `redirectURLs`).
  - **Alternative (documented, not default)**: enable DCR by setting `allowDynamicClientRegistration: true` (+ `allowUnauthenticatedClientRegistration: true`) on `mcp()` so Claude self-registers at `/oauth2/register`. Off by default; only for zero-touch onboarding.
- **VALIDATE**: `pnpm mcp:seed-client` prints a `client_id`. `select client_id, skip_consent from oauth_client;` shows the row with `skip_consent = true`.

### Task 10: Env changes
- **ACTION**: Update `src/env.ts` and `.env.example` — keep `MCP_RESOURCE_URL` as the OAuth `resource`/audience; retire the static-bearer trio.
- **IMPLEMENT**:
  - In `src/env.ts` server block: **remove** `MCP_BEARER_TOKEN`, `MCP_ORG_ID`, `MCP_USER_ID`. **Keep** `MCP_RESOURCE_URL` (now the canonical MCP resource identifier / token audience); update its comment: `// P7c: canonical MCP resource id = token audience for requireMcpAuth + mcp({ resource }). HTTPS in prod.`
  - Add `MCP_RESOURCE_URL` to `.env.example` with a sample (`https://your-host/api/mcp`) and a comment that it must be your public MCP URL.
- **MIRROR**: `src/env.ts:13-19` optional + min-length + Pxx-tagged-comment style.
- **IMPORTS**: n/a.
- **GOTCHA**:
  - Removing the trio means any code referencing `env.MCP_BEARER_TOKEN`/`MCP_USER_ID`/`MCP_ORG_ID` must be gone first (Tasks 5, 6). `grep -rn 'MCP_BEARER_TOKEN\|MCP_USER_ID\|MCP_ORG_ID' src scripts` must return zero before removing from `env.ts`.
  - `MCP_RESOURCE_URL` stays `.optional()` so the app still boots without MCP configured (endpoint 401s until set) — matches the established "inert when unconfigured" convention.
  - Update the Coolify deployment secrets checklist (drop the trio, keep `MCP_RESOURCE_URL`) — noted in Task 12 docs.
- **VALIDATE**: `grep -rn 'MCP_BEARER_TOKEN\|MCP_USER_ID\|MCP_ORG_ID' src scripts tests` → zero hits. `pnpm typecheck`. `SKIP_ENV_VALIDATION=1 pnpm build` succeeds; `pnpm dev` boots with only `MCP_RESOURCE_URL` set.

### Task 11: Tests
- **ACTION**: Add `tests/mcp-oauth.test.ts` and adapt `tests/mcp-tools.test.ts` for the ALS seam.
- **IMPLEMENT** (`tests/mcp-oauth.test.ts`):
  - **ALS→ctx (DB integration)**: seed `organization/user/member` (like `mcp-tools.test.ts:190-208`); assert `await runWithMcpPrincipal({ userId, tenantId: org }, () => resolveMcpAuthContext())` equals `{ userId, tenantId: org, role: 'owner', isPlatformAdmin: false }`; and that calling `resolveMcpAuthContext()` **outside** any `runWithMcpPrincipal` rejects with `AuthError('NO_ACTIVE_ORG')`; and that a principal whose user isn't a member rejects with `AuthError('NOT_A_MEMBER')`.
  - **org-claim resolver (DB integration)**: unit-test the `customAccessTokenClaims` logic — extract it into a small exported helper `resolveOrgClaim(userId)` in `auth.ts` (or `mcp-als.ts`) so it's testable without booting the AS; assert it returns `{ [MCP_ORG_CLAIM]: org }` for a member and `{}` for a non-member.
  - **discovery routes (unit)**: import the route `GET` handlers and assert the JSON body shape (`.well-known/oauth-protected-resource` → `resource`, `authorization_servers`; auth-server metadata → `issuer`, `token_endpoint`, `jwks_uri`). For the Better-Auth-helper routes, this may require a live `auth` context; if awkward in vitest, cover via Manual Validation instead and keep the protected-resource (mcp-handler, pure) route as the unit-tested one.
  - Keep the existing draft-and-confirm / RBAC `can()` / composer tests as-is.
- **IMPLEMENT** (`tests/mcp-tools.test.ts` adaptation): the file already `vi.mock`s `resolveMcpAuthContext` and calls tool handlers directly with the mock returning a ctx — **this keeps working unchanged** (tools still call `resolveMcpAuthContext()`). Optionally add one test that drops the mock and instead wraps a real tool invocation in `runWithMcpPrincipal(...)` to prove the ALS path end-to-end.
- **MIRROR**: `tests/mcp-tools.test.ts` (fixture lifecycle, `ctxFor`, `captureTools`, `cleanup` in beforeAll+afterAll); `tests/tenant-isolation.test.ts` for the minimal DB template; `vitest.config.ts` `server-only` stub makes `@/auth/*` importable.
- **IMPORTS**: `runWithMcpPrincipal`, `MCP_ORG_CLAIM` from `@/auth/mcp-als`; `resolveMcpAuthContext`, `mcpAuthContextFor` from `@/auth/mcp-context`; `AuthError` from `@/auth/context`; drizzle `eq`/`inArray`; schema tables + `forTenant`.
- **GOTCHA**: DB tests need a live Postgres (`DATABASE_URL`); Better Auth fixture rows require explicit `createdAt`. `resolveMcpAuthContext` is `server-only` — fine under the vitest stub alias. Don't mock `mcpAuthContextFor` (it's the real member-row check under test).
- **VALIDATE**: `pnpm test` — all suites green, including new `mcp-oauth` tests.

### Task 12: ADR + docs
- **ACTION**: Record the decision reversal and update the deployment checklist.
- **IMPLEMENT**:
  - `docs/adr/0002-mcp-oauth-better-auth.md` — mirror `0001`'s format: Context (PRD said WorkOS), Decision (Better Auth `mcp` plugin), Consequences (one identity source; self-hosted AS; new tables; "stable-but-young" version risk; consent via skipConsent), Alternatives (WorkOS — rejected for the identity bridge / second source-of-truth).
  - Update the Phase-6 report / any Coolify secrets checklist reference: MCP env is now `MCP_RESOURCE_URL` (drop `MCP_BEARER_TOKEN`/`MCP_USER_ID`/`MCP_ORG_ID`); note the pre-seed step (`pnpm mcp:seed-client`).
- **MIRROR**: `docs/adr/0001-tenant-isolation-rls.md`.
- **IMPORTS**: n/a.
- **GOTCHA**: Keep the ADR concise; link it from the plan's deviation note.
- **VALIDATE**: Files exist; ADR renders; checklist reflects the new env.

---

## Testing Strategy

### Unit / Integration Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| `resolveMcpAuthContext` in ALS | `runWithMcpPrincipal({userId,tenantId=org}, …)` | `{userId,tenantId,role:'owner',isPlatformAdmin:false}` | no |
| `resolveMcpAuthContext` outside ALS | no store | throws `AuthError('NO_ACTIVE_ORG')` | yes (defensive) |
| ALS principal, non-member user | `{userId:'ghost',tenantId:org}` | throws `AuthError('NOT_A_MEMBER')` | yes (tenant guard) |
| org-claim resolver | member userId | `{ [MCP_ORG_CLAIM]: org }` | — |
| org-claim resolver | non-member userId | `{}` | yes |
| protected-resource metadata route | GET | JSON with `resource`, `authorization_servers` | — |
| Existing tool RBAC (`can`) | owner/assistant/parent/student | unchanged pass/fail matrix | — |
| Draft-and-confirm gate | issue/consume | unchanged single-use/TTL/hash behavior | — |

### Edge Cases Checklist
- [ ] No token → 401 + `WWW-Authenticate` (RFC 9728) with `resource_metadata`.
- [ ] Token with wrong `aud` (different resource) → 401 (audience mismatch).
- [ ] Expired token → 401.
- [ ] Valid token, user demoted/removed from org between issuance and call → `NOT_A_MEMBER` (role re-derived live).
- [ ] Valid token, missing org claim → `NO_ACTIVE_ORG`.
- [ ] Cross-tenant: user A's token cannot read/write tenant B rows (`forTenant` scope).
- [ ] Write tools still require draft→confirm token (unchanged).
- [ ] `.well-known/*` reachable **without** auth.

---

## Validation Commands

### Static Analysis
```bash
pnpm typecheck
```
EXPECT: Zero type errors.

### Lint
```bash
pnpm lint
```
EXPECT: Clean.

### Unit / Integration Tests
```bash
pnpm test        # vitest run (needs DATABASE_URL for the DB-integration suites)
```
EXPECT: All suites pass, including `tests/mcp-oauth.test.ts`.

### Database / Migration
```bash
pnpm auth:generate           # regenerate auth-schema.ts (must include oauth* + jwk)
pnpm db:generate             # new drizzle/0008_*.sql
pnpm db:migrate              # [migrate] done
psql "$DATABASE_URL" -c '\dt' | grep -E 'oauth_client|oauth_access_token|jwk'
```
EXPECT: 8 new tables present; migration applied.

### Build
```bash
SKIP_ENV_VALIDATION=1 pnpm build
```
EXPECT: Standalone build succeeds (no `webpack()` hook; Turbopack).

### Browser / Protocol Validation (dev server)
```bash
pnpm dev
# 1) challenge:
curl -si -X POST localhost:3000/api/mcp -H 'content-type: application/json' -d '{}' | grep -i 'www-authenticate\|401'
# 2) discovery:
curl -s localhost:3000/.well-known/oauth-authorization-server | jq '.issuer,.authorization_endpoint,.token_endpoint,.jwks_uri'
curl -s localhost:3000/.well-known/oauth-protected-resource   | jq '.resource,.authorization_servers'
curl -s localhost:3000/api/auth/jwks | jq '.keys | length'
# 3) seed the client:
pnpm mcp:seed-client
```
EXPECT: 401 + `WWW-Authenticate`; discovery docs well-formed; ≥1 JWK; a `client_id` printed.

### Manual Validation
- [ ] In Claude (Code/Desktop/.ai), add connector URL `https://<host>/api/mcp` (no token).
- [ ] Claude bounces to `/login`; log in as the tutor; (trusted client → no `/consent`; else approve).
- [ ] Claude receives a token; `list_classes` / `list_students` return the tutor's tenant data.
- [ ] `schedule_lesson_preview` → `schedule_lesson_confirm` (with token) writes; a conflicting time is blocked.
- [ ] A second user's connector sees only THEIR tenant (cross-tenant isolation holds).
- [ ] Revoke: delete the `oauth_access_token` row (or disable the client) → next call 401s.

---

## Acceptance Criteria
- [ ] All 12 tasks completed.
- [ ] All validation commands pass.
- [ ] `requireMcpAuth` validates sig/iss/**aud**/exp; unauthenticated calls get 401 + RFC 9728 `WWW-Authenticate`.
- [ ] MCP principal is the token's `sub` (real `userId`) + org claim → `mcpAuthContextFor`; env-fixed principal removed.
- [ ] Discovery chain works end-to-end; Claude connects via OAuth login and drives the tools.
- [ ] Per-tool authz unchanged (role-based `requirePermission`); draft-and-confirm unchanged; `forTenant` isolation holds.
- [ ] No type/lint errors; migration applied; tests green.

## Completion Checklist
- [ ] Code follows discovered patterns (`server-only`, `@/` imports, kebab-case, Web `Response`).
- [ ] Error handling matches codebase style (`AuthError` codes; `runTool` mapper; no leaked stacks).
- [ ] Logging via `console.error('<fn> failed', e)` only (no new logger).
- [ ] Tests follow `/tests/` + `ctxFor`/`captureTools`/live-DB conventions.
- [ ] No hardcoded values (resource URL from env; org claim constant shared).
- [ ] ADR 0002 records the WorkOS→Better-Auth reversal; deployment checklist updated.
- [ ] No unnecessary scope additions (no scope-based authz, no open DCR, no consent-management UI).
- [ ] `nextCookies()` remains last in the plugin array; no `middleware.ts` introduced.

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `auth:generate` (the `auth@latest` CLI) doesn't detect `@better-auth/mcp` tables | M | H | Verify the 8 tables after generate; fall back to `npx @better-auth/cli@1.7.4 generate`; hand-check the SQL before migrate |
| Consent-page API not fully pinned from tarball review | M | M | Primary path uses `skipConsent:true` trusted client → page never rendered; do a targeted doc-lookup only if untrusted-client consent is needed |
| Claude's redirect URI(s) wrong in the seed | M | M | Confirm from Anthropic connector docs before seeding; adjust `redirect_uris`; DCR fallback available |
| `resource` mismatch between `mcp()` and `requireMcpAuth` → every call 401s | L | H | Single env var `MCP_RESOURCE_URL` used in both places; asserted equal in Manual Validation step 1/2 |
| Better Auth `mcp`/`oauth-provider` "stable-but-young" (renames landed in 1.7) | M | M | Pin exact `@better-auth/*` versions; re-run schema-gen after any bump; ADR notes the risk |
| `resource_metadata` path advertised by 401 not served at root | L | M | Serve root `.well-known/oauth-protected-resource` (Task 7) AND rely on Better-Auth's `/api/auth/...` copy; verify the exact advertised path in Manual Validation |
| ALS principal leaks across requests | L | H | `AsyncLocalStorage.run` is per-invocation; `nodejs` runtime; `mcpAuthContextFor` re-checks membership every call as a backstop |
| Losing the "demoted user loses access" property | L | H | Keep `mcpAuthContextFor` re-deriving role from the live `member` row (do NOT trust a role claim) |

## Notes
- **Why ALS, not a tool `extra` param**: `mcp-handler` does not forward an outer wrapper's auth into tool `ctx`/`extra`, and rewriting all 8 tool signatures would be invasive. `AsyncLocalStorage` lets `resolveMcpAuthContext()` stay a no-arg call, so the tools are byte-identical — the whole Phase-6 tool surface (RBAC gates, draft-and-confirm, `forTenant`) is preserved unchanged. This mirrors the codebase's existing "principal source is swappable, enforcement is not" design (`mcp-context.ts` comment).
- **Scopes vs RBAC**: OAuth scopes are advertised (`openid`, `offline_access`, `schedule:*`) for protocol hygiene, but per-tool authorization stays the existing role-based `requirePermission` — the source of truth for what a principal may do remains the `member.role` + `permissions.ts` matrix. This avoids a parallel, drift-prone authorization model.
- **App is now the AS**: this app both issues tokens (AS) and consumes them (RS). Both live in the same Next.js app on the single HK VPS — consistent with the PRD's low-ops, single-box posture and "own Postgres = source of truth".
- **Migration for the owner**: after deploy, the tutor removes the old bearer connector in Claude and re-adds `/api/mcp` (no token) to trigger the OAuth login. The static-bearer env vars are removed (Task 10) — no dual-auth surface.
- **One doc-lookup remains** (consent-page approve/deny API); everything else is pinned from the 1.7.4 tarballs + verified codebase reads. The `skipConsent` trusted-client path makes that lookup non-blocking for the core goal.
