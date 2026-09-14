# Plan: Phase 6 — Claude MCP Connector

## Summary

Expose the tutor's own scheduling data and actions to Claude (Claude Code / Claude.ai) through a **stateless Streamable-HTTP MCP endpoint** mounted at `src/app/api/[transport]/route.ts` via the `mcp-handler` adapter. A **static bearer token** (`withMcpAuth`) authenticates the caller; a new `resolveMcpAuthContext()` then mints the **same `AuthContext` shape** the web app already uses (from an env-configured owner `member` row, role re-derived from the DB), so every tool flows through the **existing `requirePermission` + `forTenant(ctx)` spine unchanged** — no new tenant path, no RLS gap. Six PRD capabilities ship as tools: read tools `list_classes`, `list_students`, `get_lesson_notes`; the write capabilities `schedule_lesson`/`reschedule_lesson` delivered as **draft-and-confirm pairs** (`*_preview` returns a payload-bound confirmation token and writes nothing; `*_confirm` executes only on a matching, unexpired token); and read-only `draft_parent_message`. To keep MCP and the web UI byte-identical, the scheduling create/reschedule bodies are extracted into `src/lib/schedule-core.ts` and both the server actions and the MCP tools become thin wrappers over it.

## User Story

As **the independent tutor**, I want **to list, schedule, reschedule, and look up my lessons — and draft a parent's WeChat schedule message — by talking to Claude**, so that **I can run my scheduling from a chat window with the same conflict-checking and tenant-safety as the dashboard, and every change Claude proposes is previewed and explicitly confirmed before it touches my data.**

## Problem → Solution

**Current state**: Phases 1–4 deliver auth + multi-tenant schema, full scheduling/conflict CRUD (`src/lib/conflict.ts`, `src/app/dashboard/schedule/actions.ts`), a one-way `.ics` feed + PWA, and parent PNG/link/.ics export. Every scheduling action is reachable **only through the Next.js dashboard UI** (Server Actions that call `requireAuthContext()` off the request `headers()`). There is **no programmatic surface**: Claude cannot list classes, schedule a lesson (with conflict detection), read lesson notes, or draft a parent message. The scheduling logic is also **welded into the Server Actions** (`createLessonAction`/`rescheduleLessonAction`), even though Phase-2 explicitly deferred "keep scheduling logic in `src/lib` so Phase 6 can reuse it."

**Desired state**: The tutor adds a custom connector in Claude (endpoint URL + `Authorization: Bearer <token>`). Claude can then, over conversation: **list classes/students**, **read a lesson's notes**, **preview + confirm** a new or moved lesson (running the **identical `checkTeacherConflict` + GiST-backed** write path as the UI, returning the same `CONFLICT` + suggested-slot feedback), and **draft a Chinese parent-schedule message** (reusing Phase-4's `ensureActiveShare` + `getStudentLessonsForTenant`, returning text + a `/s/<token>` link the tutor copies into WeChat — nothing is sent). All access is authenticated by a static bearer, authorized by the existing RBAC, and tenant-scoped by `forTenant(ctx)`; all writes are draft-and-confirm, never fire-and-forget.

## Metadata
- **Complexity**: **Large** (~11 files: 5 CREATE `src/lib/schedule-core.ts`, `src/auth/mcp-context.ts`, `src/lib/mcp-confirm.ts`, `src/mcp/message.ts`, `src/mcp/register-tools.ts`, `src/app/api/[transport]/route.ts`; UPDATE `src/env.ts`, `src/app/dashboard/schedule/actions.ts`, `package.json` + both lockfiles, PRD; 1 test file; new deps `mcp-handler`, `@modelcontextprotocol/server`).
- **Source PRD**: `.claude/PRPs/prds/course-scheduling-system.prd.md`
- **PRD Phase**: Phase 6 — Claude MCP Connector (`pending` → `in-progress`)
- **Depends on**: Phase 2 — Core Scheduling + Conflict (**complete**). Runs **in parallel with Phase 5** (Progress Reports). Reuses Phase-4's `share-data.ts` for `draft_parent_message` (Phase 4 code is merged on `main`). Shares only `package.json`/lockfiles, `src/env.ts`, and `src/app/dashboard/schedule/actions.ts` (a refactor, not a behavior change) with other phases.
- **Estimated Files**: ~11 (6 CREATE, 4 UPDATE, 1 test).
- **Research basis**: 1 external doc lookup — `mcp-handler` **2.1.1** (npm + Context7 `/vercel/mcp-handler`), verified 2026-09. See **External Documentation** (⚠ version-sensitive — Task 0 re-verifies before coding).

---

## Reconciliation Decisions (READ FIRST — binding choices for implementation)

| # | Decision | Chosen | Rejected | Rationale |
|---|----------|--------|----------|-----------|
| P6-1 | **MCP principal model** | A **second `AuthContext` factory**: `src/auth/mcp-context.ts#resolveMcpAuthContext()` looks up the env-configured owner `member` row (`MCP_ORG_ID`+`MCP_USER_ID`), **re-derives `role` from the live DB `member` row** (exactly like `getAuthContext`), and returns `{userId, tenantId, role, isPlatformAdmin:false}`. Every tool then uses the **unchanged** `requirePermission(ctx,…)` + `forTenant(ctx)`. | (a) Reuse the `calendarFeed`/`shareLink` raw-`db` public-read bypass; (b) accept `tenantId`/`userId` as tool args; (c) bake a static `role` into the token. | `AuthContext` is the ONLY seam downstream authz/data code depends on (never the raw session), so MCP is a **pure-additive** principal source — the entire RBAC + tenant-isolation stack (M1 spine) is reused verbatim. Re-deriving role from the member row means a demoted/removed principal loses access immediately; `isPlatformAdmin:false` prevents accidental cross-tenant god-mode; sourcing `tenantId` only from the trusted mapping (never args) preserves isolation. This is an alternate *principal source*, **not** a third raw-`db` exception — M1 fully preserved. |
| P6-2 | **Endpoint = `mcp-handler` 2.x, stateless Streamable HTTP** | `createMcpHandler(registerTools, {...})` wrapped in `withMcpAuth(handler, verifyToken, {required:true, resourceUrl})`, mounted at `src/app/api/[transport]/route.ts`, exporting **only** `GET` + `POST`; `runtime='nodejs'`, `dynamic='force-dynamic'`, `maxDuration=60`. Tools via `server.registerTool(name,{title,description,inputSchema:z.object({...})}, handler)`. | SSE / stateful transport + Redis session store (removed in 2.x); the 1.x `server.tool(...)` variadic + raw-shape `inputSchema`; a bespoke JSON-RPC handler. | PRD mandates `mcp-handler` Streamable HTTP + static bearer. 2.x is stateless → **no Redis, no DELETE** (SSE removed). `runtime='nodejs'` is REQUIRED (DB/pg + `server-only` libs can't run on edge). The `[transport]` segment is a harmless 1.x holdover that keeps the familiar `/api/mcp` URL the PRD references. |
| P6-3 | **Extract scheduling core for zero-drift reuse** | Create `src/lib/schedule-core.ts` exporting `createSchema`/`rescheduleSchema` + `scheduleLessonCore(ctx,input)`/`rescheduleLessonCore(ctx,input)` (everything from `parse` through conflict-check → `forTenant` insert/update → GiST catch → `toEvent`, returning `ScheduleResult`). `createLessonAction`/`rescheduleLessonAction` become thin wrappers (`requireAuthContext` + core + `revalidatePath`); MCP tools become thin wrappers (`resolveMcpAuthContext` + `requirePermission` + core). | MCP imports the Server Actions directly; duplicate the scheduling logic inside the MCP layer. | Server Actions call `requireAuthContext()` (→ `headers()`, unavailable to MCP) and `revalidatePath()` (throws outside a request/render). Extraction is the ONLY way to guarantee **byte-identical** conflict semantics + result shape across UI and MCP. Precedent: `materializeSection` already lives in `src/lib` with the comment *"Phase-6 MCP shares it"*, and Phase-2 NOT-Building said to keep scheduling logic in `src/lib` for exactly this. |
| P6-4 | **Read tools use `forTenant(ctx)` directly** | `list_classes`/`list_students`/`get_lesson_notes` call `forTenant(ctx).select(table, extra)` (+ a `course` join for the class label) inside their handlers, projecting to compact JSON. | Import the dashboard read Server Actions (`listStudents`, `listSections`) — they call `requireAuthContext()`/`headers()`; use raw `db.select`. | Reads are simple selects; the sanctioned path is `forTenant(ctx)` (M1 — no RLS backstop). Reusing the Server Actions would re-introduce the `headers()` coupling P6-3 removes. No new data module needed. |
| P6-5 | **Write tools = draft-and-confirm pair, server-enforced** | Each write capability is TWO tools: `schedule_lesson_preview` (resolve ctx → `requirePermission` → parse → load section → `checkTeacherConflict` → return human-readable preview **+ a `confirmationToken` bound to a SHA-256 hash of the payload, TTL 5 min**; **writes nothing**) and `schedule_lesson_confirm` (re-`requirePermission`, verify token exists/unexpired/**payload-hash matches**, then run `scheduleLessonCore`; single-use token). Same for `reschedule_*`. Token store = module-scope `Map` in `src/lib/mcp-confirm.ts`. | One fire-and-forget write tool; a single tool with a `confirm:boolean` arg (model-dependent); MCP elicitation (uneven client support). | PRD: *"所有写/外发工具 draft-and-confirm，绝不 fire-and-forget."* `mcp-handler` has no built-in confirm gate, so it is **enforced server-side** (token + payload-hash) — the write core is unreachable except via a valid `*_confirm`, so the model cannot skip confirmation. These two pairs realize the PRD's `schedule_lesson`/`reschedule_lesson` capabilities. |
| P6-6 | **`draft_parent_message` = read-only, reuse Phase-4 helpers** | Resolve ctx → `requirePermission({student:['read'],lesson:['read']})` → `ensureActiveShare(ctx,studentId)` → `getStudentLessonsForTenant(ctx,studentId,cardWindow())` → compose a Chinese message (pure `src/mcp/message.ts`) from `student.name` + `FeedLesson[]` (Asia/Shanghai) + `${NEXT_PUBLIC_APP_URL}/s/${token}`. Returns text only. | Actually send WeChat/email; re-query raw `db`; invent a new data path. | Sending is Phase 7 (channels undecided). Reuses the exact authenticated data recipe the Phase-4 PNG route uses (`share-data.ts` on the `forTenant` spine — NOT the public `share.ts` path). `ensureActiveShare` is an idempotent benign write (same as the export route), so it is exempt from draft-and-confirm. |
| P6-7 | **RBAC — reuse existing org roles/statements** | Per-tool `requirePermission`: reads → `{student:['list'\|'read']}` / `{course:['read']}` / `{lesson:['read']}`; `schedule_*` → `{lesson:['create']}`; `reschedule_*` → `{lesson:['update']}`; `draft_parent_message` → `{student:['read'],lesson:['read']}`. The bearer maps to the owner member (`role='owner'` → all perms), but `requirePermission` still runs. | Add new AC statements/roles for MCP; skip `requirePermission` because "it's just the owner." | Mirrors P4-9 (reuse `student`/`lesson` perms). Running `requirePermission` keeps the MCP path honest if the configured principal is ever downgraded, and makes Phase-7 per-user MCP OAuth a drop-in. |
| P6-8 | **Env config** | Add to `src/env.ts` **server** block: `MCP_BEARER_TOKEN: z.string().min(32)`, `MCP_ORG_ID: z.string().min(1)`, `MCP_USER_ID: z.string().min(1)`, `MCP_RESOURCE_URL: z.url().optional()`. Verified with a constant-time compare; principal from `MCP_ORG_ID`/`MCP_USER_ID`. | A DB `mcp_token` table (per-tenant tokens + revocation); putting the secret in `client:`. | MVP is a single tutor + single static token (PRD "静态 bearer token") — env is the leanest match. Server-only keys are never bundled client-side and are read directly from `process.env` (no `experimental__runtimeEnv` entry). A token table is Phase-7 territory and is superseded by MCP OAuth 2.1 anyway. |

---

## UX Design

### Before
```
┌────────────────────────────────────────────────────────────┐
│ Scheduling is reachable ONLY via the Next.js dashboard UI.   │
│ To add/move a lesson or look up notes, the tutor opens the   │
│ browser, navigates the calendar, and clicks. No programmatic │
│ surface — Claude cannot see or touch the schedule.           │
└────────────────────────────────────────────────────────────┘
```

### After
```
┌──────────────────────────────────────────────────────────────────────┐
│ Tutor adds a custom connector in Claude Code / Claude.ai:              │
│   URL:  https://<host>/api/mcp                                         │
│   Header: Authorization: Bearer <MCP_BEARER_TOKEN>                     │
│                                                                        │
│ 教师: “列出我的班级和学生”                                              │
│   → list_classes / list_students  (tenant-scoped JSON)                 │
│ 教师: “帮小明周三 16:00 加一节数学课”                                    │
│   → schedule_lesson_preview → “将为 <班级> 排 09-11 16:00–17:00，无冲突。│
│      确认请调用 schedule_lesson_confirm，confirmationToken=…”           │
│      (若冲突) → “与 X 冲突；可选 15:00 / 17:30 …”  (writes nothing)      │
│   → schedule_lesson_confirm(token, same args) → 已排课 ✓               │
│ 教师: “给小明家长写条课表通知”                                          │
│   → draft_parent_message → 中文草稿 + https://host/s/<token>           │
│      (tutor reviews, copies into WeChat — nothing auto-sent)           │
└──────────────────────────────────────────────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Schedule / move a lesson | dashboard calendar click | Claude: `*_preview` → confirm | same conflict check + suggestions; explicit 2-step confirm |
| List classes / students | dashboard pages | Claude: `list_classes` / `list_students` | tenant-scoped, read-only |
| Read a lesson's notes | open lesson detail | Claude: `get_lesson_notes` | filters by `lesson_id`; internal-note leak guarded |
| Message a parent | manual WeChat compose | Claude: `draft_parent_message` → paste | drafts only; reuses Phase-4 share link; no send |
| Auth | browser session cookie | static bearer → owner `AuthContext` | HTTPS-only; rotate via env; Phase-7 OAuth |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/auth/context.ts` | 1-52 | `AuthContext` interface + `AuthError` + `getAuthContext` (the member-row role re-derivation `resolveMcpAuthContext` MIRRORS). |
| P0 | `src/auth/authorize.ts` | 1-19 | `requirePermission(ctx,…)` + `can()` — **pure**, reused verbatim by every MCP tool. |
| P0 | `src/db/tenant.ts` | 1-55 | `forTenant(ctx)` — the M1 "ONLY sanctioned path to tenant data" (no RLS). Every MCP read/write goes through it. |
| P0 | `src/app/dashboard/schedule/actions.ts` | 15-140 | `createLessonAction`/`rescheduleLessonAction` + file-private `toEvent`/`toHHmm` + `createSchema`/`rescheduleSchema` — the code EXTRACTED into `schedule-core.ts` (P6-3). |
| P0 | `src/lib/conflict.ts` | 1-53 | `checkTeacherConflict(ctx,{teacherId,startAt,endAt,excludeLessonId?})` + `ConflictCheck`/`ConflictSummary` — reused as-is; do NOT reimplement overlap logic. |
| P0 | `src/lib/errors.ts` | 1-19 | `ConflictError` + `isExclusionViolation` (GiST 23P01 detection) — mandatory try/catch on every insert/update. |
| P1 | `src/auth/permissions.ts` | 1-77 | `orgRoles` (owner/admin/teacher/assistant/parent/student) + `Statements` — the permission vocabulary for P6-7. |
| P1 | `src/app/dashboard/schedule/types.ts` | 1-22 | `CalendarEvent` + `ScheduleResult` discriminated union — the MCP write tools serialize this shape. |
| P1 | `src/env.ts` | 1-19 | `@t3-oss/env-nextjs` `server`/`client` shape; add the MCP keys to `server:` (P6-8). |
| P1 | `src/app/api/export/student/[studentId]/ics/route.ts` | 1-35 | Next-16 Route Handler canon: `runtime='nodejs'`, `dynamic='force-dynamic'`, `await params`, `Response`/`Response.json` (NOT `NextResponse`), 401/404 shape. |
| P1 | `src/app/dashboard/students/share-data.ts` | all | `ensureActiveShare(ctx,studentId)` + `getStudentLessonsForTenant(ctx,studentId,window)` — the authenticated data source `draft_parent_message` reuses (P6-6). |
| P1 | `src/lib/ical-feed.ts` | 1-30 | `FeedLesson` shape + `cardWindow()` / `feedWindow()` windows used by `draft_parent_message`. |
| P1 | `src/lib/share.ts` | 26-47 | `sliceLessonsForSections` + `FeedLesson` projection — confirms the message data is pre-sliced/safe. |
| P1 | `src/db/schema/lesson.ts` + `course.ts` + `student.ts` + `note.ts` + `enrollment.ts` | all | Exact columns/enums the tools read/write (see **Patterns to Mirror**). |
| P2 | `drizzle/0001_lesson_teacher_exclusion.sql` | all | The GiST `lesson_no_teacher_overlap` constraint (authoritative conflict backstop; NULL `teacher_id` exempt). |
| P2 | `tests/conflict.test.ts` + `tests/rbac-scheduling.test.ts` + `tests/tenant-isolation.test.ts` | all | The `ctxFor()` stub, DB fixture lifecycle, `can()` matrix style to mirror in `tests/mcp-tools.test.ts`. |
| P2 | `.claude/PRPs/plans/phase-4-parent-sharing-export.plan.md` | all | Plan house-style (this doc follows it). |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| `mcp-handler` 2.x on Next.js | npm `mcp-handler@2.1.1` + Context7 `/vercel/mcp-handler` (README, `docs/AUTHORIZATION.md`) | `createMcpHandler(cb, options)` → a `(req)=>Promise<Response>` you export as **both** `GET` and `POST`. Register tools with `server.registerTool(name,{title,description,inputSchema:z.object({...})}, async (args,ctx)=>({content:[{type:'text',text}]}))`. Stateless — **no Redis, no DELETE**. |
| Static bearer auth | `docs/AUTHORIZATION.md`, `examples/auth/route.ts` | `withMcpAuth(handler, verifyToken, {required:true, requiredScopes?, resourceUrl?})`. `verifyToken:(req, bearerToken?)=>Promise<AuthInfo\|undefined>` — return `undefined` to reject (401), or `{token,clientId,scopes,…}` to accept. `required` defaults to **false** — must pass `true`. Auth inside a tool = `ctx.http?.authInfo`. |
| Package identity / peers | npm | `mcp-handler@^2` peers `@modelcontextprotocol/server@^2` (the renamed successor of `@modelcontextprotocol/sdk`) + `next>=13`. No `react` peer → Next 16 / React 19 OK. `zod@^4` (repo 4.6.3 OK). |
| Runtime / security | Context7 | `runtime='nodejs'` mandatory for DB; `dynamic='force-dynamic'`; `maxDuration` (Vercel ceiling — a no-op on the self-hosted VPS). Set `resourceUrl` to validate audience (anti confused-deputy); draft-and-confirm is userland. |

```
KEY_INSIGHT: mcp-handler 2.x is a HARD BREAK from 1.x. Use registerTool + z.object(...) inputSchema, import AuthInfo from '@modelcontextprotocol/server', read auth via ctx.http?.authInfo, and export ONLY GET/POST (no Redis, no DELETE).
APPLIES_TO: Task 6 (register-tools), Task 7 (route)
GOTCHA: Many online tutorials show 1.x — server.tool(...), raw-shape inputSchema { field: z.string() }, extra.authInfo, Redis. Those will NOT compile/work. Task 0 re-verifies the exact package name/version/API against `npm view` + the mcp-handler README before writing code; if the 2.x package name differs at install time, adapt imports accordingly.

KEY_INSIGHT: The stateless handler rebuilds a fresh McpServer per request, so the draft-and-confirm token Map MUST live at MODULE scope (src/lib/mcp-confirm.ts), never inside the createMcpHandler callback — otherwise every request starts with an empty store and confirm always fails.
APPLIES_TO: Task 4 (mcp-confirm), Task 6 (tools)
GOTCHA: Single-instance (one VPS via Coolify) makes an in-process Map correct. Document the multi-instance caveat + the signed-token alternative for Phase 7 scale-out.

KEY_INSIGHT: AuthContext is a plain interface; requirePermission + forTenant depend ONLY on it, never on the Better Auth session. So MCP auth is a pure-additive second AuthContext factory — the whole RBAC + isolation stack is reused unchanged.
APPLIES_TO: Task 3 (mcp-context), Task 6 (tools)
GOTCHA: Set isPlatformAdmin:false (true bypasses ALL tenant RBAC), re-derive role from the live member row, and NEVER accept tenantId/userId from tool args.
```

---

## Patterns to Mirror

All snippets are **verbatim** from the current codebase (or the verified `mcp-handler` 2.x docs).

### PRINCIPAL_DERIVATION (mirror the member-row role re-derivation for MCP)
```ts
// SOURCE: src/auth/context.ts:14-51
export interface AuthContext {
  userId: string
  tenantId: string
  role: string
  isPlatformAdmin: boolean
}
export async function getAuthContext(): Promise<AuthContext | null> {
  const session = await auth.api.getSession({ headers: await headers(), query: { disableCookieCache: true } })
  if (!session?.session) return null
  const tenantId = session.session.activeOrganizationId
  if (!tenantId) return null
  // Re-derive role from the DB member row (a stale/forged cookie cannot grant access):
  const [m] = await db.select({ role: member.role }).from(member)
    .where(and(eq(member.organizationId, tenantId), eq(member.userId, session.user.id))).limit(1)
  if (!m) return null
  return { userId: session.user.id, tenantId, role: m.role, isPlatformAdmin: (session.user.role ?? '').split(',').includes('superadmin') }
}
```

### RBAC_PERMISSION_CHECK (reuse verbatim — pure, ctx-only)
```ts
// SOURCE: src/auth/authorize.ts:5-17
export type PermissionRequest = { [R in keyof Statements]?: Statements[R][number][] }
export function can(role: string, permission: PermissionRequest): boolean {
  return role.split(',').map((r) => r.trim())
    .some((name) => orgRoles[name as OrgRole]?.authorize(permission).success === true)
}
export function requirePermission(ctx: AuthContext, permission: PermissionRequest): void {
  if (ctx.isPlatformAdmin) return // cross-tenant operator bypasses tenant RBAC
  if (!can(ctx.role, permission)) throw new AuthError('FORBIDDEN')
}
```

### TENANT_SCOPED_DATA_LAYER (the M1 spine — MCP reads/writes go through this)
```ts
// SOURCE: src/db/tenant.ts:14-47
export function forTenant(ctx: AuthContext) {
  const scope = (t: TenantTable) => eq(t.tenantId, ctx.tenantId)
  return {
    select<T extends TenantTable>(t: T, extra?: SQL) {
      const table = t as unknown as PgTable
      return db.select().from(table).where(extra ? and(scope(t), extra) : scope(t))
    },
    async findById<T extends TenantTable>(t: T, id: string) {
      const rows = await db.select().from(t as unknown as PgTable).where(and(scope(t), eq(t.id, id))).limit(1)
      return rows[0] ?? null
    },
    insert<T extends TenantTable>(t: T, values: Record<string, unknown>) {
      return db.insert(t as unknown as PgTable).values({ ...values, tenantId: ctx.tenantId }).returning() // forces tenantId
    },
    update<T extends TenantTable>(t: T, id: string, values: Record<string, unknown>) {
      const { tenantId: _t, id: _id, ...safe } = values as Record<string, unknown>
      void _t; void _id
      return db.update(t as unknown as PgTable).set(safe).where(and(scope(t), eq(t.id, id))).returning()
    },
  }
}
```

### SCHEDULE_CREATE_FULL_FLOW (the body extracted into `scheduleLessonCore`)
```ts
// SOURCE: src/app/dashboard/schedule/actions.ts:44-88
export async function createLessonAction(input: z.input<typeof createSchema>): Promise<ScheduleResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['create'] })
  const data = createSchema.parse(input)
  const section = (await forTenant(ctx).findById(classSection, data.sectionId)) as typeof classSection.$inferSelect | null
  if (!section) throw new Error('班级不存在或不属于当前机构')
  const teacherId = section.teacherId
  if (!teacherId) throw new Error('班级尚未指定教师，无法排课')
  const check = await checkTeacherConflict(ctx, { teacherId, startAt: data.startAt, endAt: data.endAt })
  if (check.hasConflict) {
    return { ok: false, error: 'CONFLICT', conflicts: check.conflicts.map((c) => ({ id: c.id, title: c.title })), suggestions: check.suggestions.map(toHHmm) }
  }
  try {
    const [row] = await forTenant(ctx).insert(lesson, { sectionId: section.id, teacherId, startAt: data.startAt, endAt: data.endAt, title: data.title, status: 'scheduled', isException: true })
    revalidatePath('/dashboard/schedule')
    return { ok: true, event: toEvent(row as typeof lesson.$inferSelect) }
  } catch (e) {
    if (isExclusionViolation(e)) throw new ConflictError()
    throw e
  }
}
```

### SCHEDULE_RESCHEDULE_FULL_FLOW (extracted into `rescheduleLessonCore`; note `excludeLessonId`)
```ts
// SOURCE: src/app/dashboard/schedule/actions.ts:101-140
export async function rescheduleLessonAction(input: z.input<typeof rescheduleSchema>): Promise<ScheduleResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['update'] })
  const data = rescheduleSchema.parse(input)
  const existing = (await forTenant(ctx).findById(lesson, data.id)) as typeof lesson.$inferSelect | null
  if (!existing) throw new Error('课节不存在')
  if (!existing.teacherId) throw new Error('课节缺少教师信息')
  const check = await checkTeacherConflict(ctx, { teacherId: existing.teacherId, startAt: data.startAt, endAt: data.endAt, excludeLessonId: data.id })
  if (check.hasConflict) { return { ok: false, error: 'CONFLICT', conflicts: check.conflicts.map((c) => ({ id: c.id, title: c.title })), suggestions: check.suggestions.map(toHHmm) } }
  try {
    const [row] = await forTenant(ctx).update(lesson, data.id, { startAt: data.startAt, endAt: data.endAt, isException: true })
    revalidatePath('/dashboard/schedule')
    return { ok: true, event: toEvent(row as typeof lesson.$inferSelect) }
  } catch (e) { if (isExclusionViolation(e)) throw new ConflictError(); throw e }
}
```

### ZOD_SCHEMA_AND_LOCAL_HELPERS (move these into `schedule-core.ts` and export the schemas)
```ts
// SOURCE: src/app/dashboard/schedule/actions.ts:15-46
const ZONE = 'Asia/Shanghai'
function toEvent(row: typeof lesson.$inferSelect): CalendarEvent {
  return { id: row.id, title: row.title ?? '课节', start: row.startAt.toISOString(), end: row.endAt.toISOString(), sectionId: row.sectionId, status: row.status }
}
function toHHmm(d: Date): string { return DateTime.fromJSDate(d).setZone(ZONE).toFormat('HH:mm') }

const createSchema = z.object({
    sectionId: z.string().trim().min(1),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    title: z.string().trim().max(120).optional(),
  }).refine((d) => d.endAt > d.startAt, { message: '结束时间必须晚于开始时间', path: ['endAt'] })
// rescheduleSchema = z.object({ id: z.string().trim().min(1), startAt: z.coerce.date(), endAt: z.coerce.date() }).refine(endAt>startAt)
```

### CONFLICT_CHECK_SIGNATURE (reuse as-is — pure, ctx-first, byte-identical to the UI)
```ts
// SOURCE: src/lib/conflict.ts:8-53
export interface ConflictCheck { hasConflict: boolean; conflicts: ConflictSummary[]; suggestions: Date[] }
export async function checkTeacherConflict(
  ctx: AuthContext,
  args: { teacherId: string; startAt: Date; endAt: Date; excludeLessonId?: string },
): Promise<ConflictCheck> { /* tstzrange '[)' overlap via forTenant(ctx).select(lesson, …); suggestions only when conflict */ }
```

### RESULT_SHAPE (MCP write tools serialize this discriminated union)
```ts
// SOURCE: src/app/dashboard/schedule/types.ts:5-22
export interface CalendarEvent { id: string; title: string; start: string; end: string; sectionId: string; status: 'scheduled' | 'completed' | 'canceled' }
export type ScheduleResult =
  | { ok: true; event: CalendarEvent }
  | { ok: false; error: 'CONFLICT'; conflicts: Pick<ConflictSummary, 'id' | 'title'>[]; suggestions: string[] } // 'HH:mm' Asia/Shanghai
```

### ERROR_TAXONOMY (map these to MCP content in tool handlers)
```ts
// SOURCE: src/lib/errors.ts:3-19
export class ConflictError extends Error { constructor(public detail = '时间冲突') { super('CONFLICT'); this.name = 'ConflictError' } }
export function isExclusionViolation(e: unknown): boolean { /* walks .cause chain 5 deep for code === '23P01' */ }
// Also src/auth/context.ts:8-13 — AuthError { code: 'UNAUTHENTICATED'|'NO_ACTIVE_ORG'|'NOT_A_MEMBER'|'FORBIDDEN' }
```

### ROUTE_HANDLER_NEXT16 (endpoint config + response conventions)
```ts
// SOURCE: src/app/api/export/student/[studentId]/ics/route.ts:9-16 & src/app/api/health/route.ts:1-6
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(_req: Request, { params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params // Next 16: params is a Promise — MUST await
  // ... new Response('Not found', { status: 404 }) / Response.json(obj, { status }) — NOT NextResponse
}
```

### T3_ENV (add MCP keys to the server block)
```ts
// SOURCE: src/env.ts:1-19
export const env = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    PLAYWRIGHT_CHROMIUM_PATH: z.string().optional(),
  },
  client: { NEXT_PUBLIC_APP_URL: z.url() },
  experimental__runtimeEnv: { NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL },
  emptyStringAsUndefined: true,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
})
```

### PARENT_FACING_DATA_ASSEMBLY (reuse verbatim for `draft_parent_message`)
```ts
// SOURCE: src/app/api/export/student/[studentId]/png/route.ts:18-36
const ctx = await requireAuthContext()
requirePermission(ctx, { student: ['read'], lesson: ['read'] })
const s = (await forTenant(ctx).findById(student, studentId)) as typeof student.$inferSelect | null
if (!s) return new Response('Not found', { status: 404 })
const share = await ensureActiveShare(ctx, studentId)                   // idempotent shareLink
const shareUrl = `${env.NEXT_PUBLIC_APP_URL}/s/${share.token}`
const lessons = await getStudentLessonsForTenant(ctx, studentId, cardWindow()) // FeedLesson[] on the forTenant spine
```

### MCP_ENDPOINT_2X (verified `mcp-handler` 2.x — static bearer + Zod tools + stateless)
```ts
// SOURCE: Context7 /vercel/mcp-handler (README + docs/AUTHORIZATION.md), verified 2026-09
import type { AuthInfo } from '@modelcontextprotocol/server'
import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { z } from 'zod'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const handler = createMcpHandler((server) => {
  server.registerTool('list_courses',
    { title: 'List Courses', description: '…', inputSchema: z.object({ term: z.string() }) },
    async ({ term }, ctx) => {
      const auth = ctx.http?.authInfo // AuthInfo | undefined
      return { content: [{ type: 'text', text: `…` }] }
    })
}, { serverInfo: { name: 'course-scheduling-mcp', version: '1.0.0' }, capabilities: { tools: { listChanged: true } } })

const verifyToken = async (_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> => {
  if (!bearerToken) return undefined
  const { timingSafeEqual } = await import('node:crypto')
  const a = Buffer.from(bearerToken), b = Buffer.from(env.MCP_BEARER_TOKEN)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined
  return { token: bearerToken, clientId: 'course-scheduler', scopes: ['schedule:read', 'schedule:write'] }
}
const authHandler = withMcpAuth(handler, verifyToken, { required: true, resourceUrl: env.MCP_RESOURCE_URL })
export { authHandler as GET, authHandler as POST } // stateless => no DELETE, no Redis
```

### MCP_DRAFT_AND_CONFIRM (server-enforced payload-hash gate)
```ts
// SOURCE: Context7 /vercel/mcp-handler (security guidance), verified 2026-09 — token store at MODULE scope
import crypto from 'node:crypto'
const PENDING = new Map<string, { payloadHash: string; expiresAt: number }>()
const hash = (o: unknown) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex')
// *_preview: PENDING.set(crypto.randomUUID(), { payloadHash: hash(args), expiresAt: Date.now() + 5*60_000 }) → return token, write NOTHING
// *_confirm: reject unless PENDING has token, unexpired, and payloadHash === hash(resubmitted args); single-use (delete on read)
```

### TEST_STUB_AND_RBAC_MATRIX (mirror for `tests/mcp-tools.test.ts`)
```ts
// SOURCE: tests/tenant-isolation.test.ts:9-14 + tests/rbac-scheduling.test.ts:1-12
const ctxFor = (tenantId: string, userId: string, role = 'owner'): AuthContext => ({ tenantId, userId, role, isPlatformAdmin: false })
// RBAC unit style: expect(can('assistant', { lesson: ['create'] })).toBe(true); expect(can('parent', { lesson: ['create'] })).toBe(false)
// DB fixture: seed organization+user+member (createdAt REQUIRED, no default); idempotent cleanup() in beforeAll AND afterAll; delete children before parents.
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `package.json` (+ `pnpm-lock.yaml` + `package-lock.json`) | UPDATE | Add `mcp-handler` + `@modelcontextprotocol/server` (P6-2). Sync **both** lockfiles (PR #4 lesson). |
| `src/env.ts` | UPDATE | Add `MCP_BEARER_TOKEN`/`MCP_ORG_ID`/`MCP_USER_ID`/`MCP_RESOURCE_URL` to `server:` (P6-8). |
| `src/lib/schedule-core.ts` | CREATE | Extracted `createSchema`/`rescheduleSchema` + `scheduleLessonCore`/`rescheduleLessonCore` + `toEvent`/`toHHmm` (P6-3). |
| `src/app/dashboard/schedule/actions.ts` | UPDATE | Refactor `createLessonAction`/`rescheduleLessonAction` to thin wrappers over `schedule-core` (behavior-preserving). |
| `src/auth/mcp-context.ts` | CREATE | `resolveMcpAuthContext()` — bearer→owner `AuthContext` (P6-1). |
| `src/lib/mcp-confirm.ts` | CREATE | Module-scope payload-hash confirmation store: `issueConfirmation`/`consumeConfirmation`/`hashPayload` (P6-5). |
| `src/mcp/message.ts` | CREATE | Pure Chinese parent-message composer (`FeedLesson[]` + shareUrl → text) (P6-6). |
| `src/mcp/register-tools.ts` | CREATE | `registerCourseSchedulingTools(server)` — the 8 tools (P6-4/5/6/7). |
| `src/app/api/[transport]/route.ts` | CREATE | `createMcpHandler` + `withMcpAuth` + `GET`/`POST` (P6-2). |
| `tests/mcp-tools.test.ts` | CREATE | RBAC matrix + confirm-store + message composer (pure) + `schedule-core`/`resolveMcpAuthContext` (DB). |
| `.env.example` (if present) / deployment secrets | UPDATE | Document `MCP_BEARER_TOKEN`/`MCP_ORG_ID`/`MCP_USER_ID`. |
| `.claude/PRPs/prds/course-scheduling-system.prd.md` | UPDATE | Phase 6 `pending`→`in-progress` + link this plan. |
| `src/auth/authorize.ts`, `src/db/tenant.ts`, `src/lib/conflict.ts`, `src/lib/errors.ts`, `src/auth/permissions.ts`, `src/app/dashboard/students/share-data.ts` | (NO CHANGE) | Reused verbatim — verify only. |
| `next.config.ts` | (NO CHANGE — verify) | `mcp-handler`/`@modelcontextprotocol/server` are pure JS → bundle fine; confirm `pnpm build` traces them into `.next/standalone` (add to `serverExternalPackages` only if the build complains). |

## NOT Building
- **MCP OAuth 2.1 / WorkOS AuthKit** — Phase 7. MVP is a static bearer (`withMcpAuth`).
- **Per-user / per-tenant MCP tokens + a `mcp_token` table + revocation UI** — Phase 7 (superseded by OAuth). MVP maps the single token to one env-configured owner.
- **Actually sending** WeChat/email/anything — `draft_parent_message` only drafts. Outbound send is Phase 7.
- **Recurring-series scheduling via MCP** (`materializeSection` through a tool) — MVP `schedule_lesson` creates a single ad-hoc lesson (`is_exception=true`); series creation stays in the UI. Documented as a future tool.
- **Reschedule-request (parent self-service) workflow** — Phase 7. `reschedule_lesson` here is the tutor moving a lesson directly (operates on `lesson`, NOT `reschedule_request`).
- **New RBAC statements/roles** — reuse `student`/`course`/`lesson` perms (P6-7).
- **Room/location conflict detection** — does not exist in the codebase; not added.
- **MCP resources or prompts** — tools only for MVP.
- **Reusing/altering the `calendarFeed`/`shareLink` public-read bypass** — MCP goes through `forTenant`, not a raw-`db` exception.

---

## Step-by-Step Tasks

### Task 0: Verify + install `mcp-handler` 2.x (+ lockfile sync)
- **ACTION**: Re-verify the current `mcp-handler` package name/version/API, then install.
- **IMPLEMENT**: `npm view mcp-handler version peerDependencies` and open the `mcp-handler` README to confirm the 2.x surface (`createMcpHandler`, `withMcpAuth`, `server.registerTool`, `z.object` inputSchema, `ctx.http?.authInfo`, `AuthInfo` import path). Then `pnpm add mcp-handler @modelcontextprotocol/server` (versions per `npm view`).
- **MIRROR**: `MCP_ENDPOINT_2X` (External Documentation).
- **IMPORTS**: n/a (CLI).
- **GOTCHA**: (1) 1.x tutorials (`server.tool(...)`, raw-shape `inputSchema`, `extra.authInfo`, Redis) will NOT work — trust the README/`npm view`, not blog memory. (2) If the peer package name at install time is not `@modelcontextprotocol/server`, install whatever `mcp-handler`'s `peerDependencies` names and adjust the `AuthInfo` import in Tasks 6/7. (3) Repo keeps **both** `pnpm-lock.yaml` (local) and `package-lock.json` (CI/Docker `npm ci`) — after `pnpm add`, run `npm install --package-lock-only` and commit **both** (lockfile drift sank PR #4). (4) Dedupe `zod` to one version (`pnpm why zod`) so tool schemas and `mcp-handler` share one Standard-Schema instance.
- **VALIDATE**: `pnpm install` clean; `pnpm why zod` shows a single 4.6.x; `git diff` touches both lockfiles.

### Task 1: `src/env.ts` — MCP config keys
- **ACTION**: Add the MCP server-only keys.
- **IMPLEMENT**: In `server: { … }` add `MCP_BEARER_TOKEN: z.string().min(32)`, `MCP_ORG_ID: z.string().min(1)`, `MCP_USER_ID: z.string().min(1)`, `MCP_RESOURCE_URL: z.url().optional()`.
- **MIRROR**: `T3_ENV` (mirror `BETTER_AUTH_SECRET: z.string().min(32)`).
- **IMPORTS**: existing (`z`, `createEnv`).
- **GOTCHA**: Server-only — do **NOT** add to `client:` or `experimental__runtimeEnv` (that section is only for `NEXT_PUBLIC_*`). `emptyStringAsUndefined:true` means a blank value fails the required (non-`.optional()`) validators. `next.config.ts` does `import './src/env'`, so a missing var fails the build unless `SKIP_ENV_VALIDATION=1` (Docker build). Consume as `env.MCP_BEARER_TOKEN` etc.
- **VALIDATE**: `pnpm typecheck`; app boots with the vars set; `SKIP_ENV_VALIDATION=1 pnpm build` still builds.

### Task 2: Extract `src/lib/schedule-core.ts` + slim the Server Actions
- **ACTION**: Move `createSchema`/`rescheduleSchema`, `toEvent`/`toHHmm`, and the create/reschedule bodies into `src/lib/schedule-core.ts`; refactor `schedule/actions.ts` to thin wrappers.
- **IMPLEMENT**:
  ```ts
  // src/lib/schedule-core.ts
  import 'server-only'
  import { z } from 'zod'
  import { DateTime } from 'luxon'
  import type { AuthContext } from '@/auth/context'
  import { forTenant } from '@/db/tenant'
  import { classSection, lesson } from '@/db/schema'
  import { checkTeacherConflict } from '@/lib/conflict'
  import { ConflictError, isExclusionViolation } from '@/lib/errors'
  import type { CalendarEvent, ScheduleResult } from '@/app/dashboard/schedule/types'

  const ZONE = 'Asia/Shanghai'
  export const createSchema = z.object({
    sectionId: z.string().trim().min(1), startAt: z.coerce.date(), endAt: z.coerce.date(),
    title: z.string().trim().max(120).optional(),
  }).refine((d) => d.endAt > d.startAt, { message: '结束时间必须晚于开始时间', path: ['endAt'] })
  export const rescheduleSchema = z.object({
    id: z.string().trim().min(1), startAt: z.coerce.date(), endAt: z.coerce.date(),
  }).refine((d) => d.endAt > d.startAt, { message: '结束时间必须晚于开始时间', path: ['endAt'] })

  function toEvent(row: typeof lesson.$inferSelect): CalendarEvent {
    return { id: row.id, title: row.title ?? '课节', start: row.startAt.toISOString(), end: row.endAt.toISOString(), sectionId: row.sectionId, status: row.status }
  }
  function toHHmm(d: Date): string { return DateTime.fromJSDate(d).setZone(ZONE).toFormat('HH:mm') }

  export async function scheduleLessonCore(ctx: AuthContext, input: z.input<typeof createSchema>): Promise<ScheduleResult> {
    const data = createSchema.parse(input)
    const section = (await forTenant(ctx).findById(classSection, data.sectionId)) as typeof classSection.$inferSelect | null
    if (!section) throw new Error('班级不存在或不属于当前机构')
    const teacherId = section.teacherId
    if (!teacherId) throw new Error('班级尚未指定教师，无法排课')
    const check = await checkTeacherConflict(ctx, { teacherId, startAt: data.startAt, endAt: data.endAt })
    if (check.hasConflict) return { ok: false, error: 'CONFLICT', conflicts: check.conflicts.map((c) => ({ id: c.id, title: c.title })), suggestions: check.suggestions.map(toHHmm) }
    try {
      const [row] = await forTenant(ctx).insert(lesson, { sectionId: section.id, teacherId, startAt: data.startAt, endAt: data.endAt, title: data.title, status: 'scheduled', isException: true })
      return { ok: true, event: toEvent(row as typeof lesson.$inferSelect) }
    } catch (e) { if (isExclusionViolation(e)) throw new ConflictError(); throw e }
  }
  export async function rescheduleLessonCore(ctx: AuthContext, input: z.input<typeof rescheduleSchema>): Promise<ScheduleResult> {
    const data = rescheduleSchema.parse(input)
    const existing = (await forTenant(ctx).findById(lesson, data.id)) as typeof lesson.$inferSelect | null
    if (!existing) throw new Error('课节不存在')
    if (!existing.teacherId) throw new Error('课节缺少教师信息')
    const check = await checkTeacherConflict(ctx, { teacherId: existing.teacherId, startAt: data.startAt, endAt: data.endAt, excludeLessonId: data.id })
    if (check.hasConflict) return { ok: false, error: 'CONFLICT', conflicts: check.conflicts.map((c) => ({ id: c.id, title: c.title })), suggestions: check.suggestions.map(toHHmm) }
    try {
      const [row] = await forTenant(ctx).update(lesson, data.id, { startAt: data.startAt, endAt: data.endAt, isException: true })
      return { ok: true, event: toEvent(row as typeof lesson.$inferSelect) }
    } catch (e) { if (isExclusionViolation(e)) throw new ConflictError(); throw e }
  }
  ```
  Then in `src/app/dashboard/schedule/actions.ts`, delete the moved consts/helpers and make the actions thin:
  ```ts
  import { createSchema, rescheduleSchema, scheduleLessonCore, rescheduleLessonCore } from '@/lib/schedule-core'
  export async function createLessonAction(input: z.input<typeof createSchema>): Promise<ScheduleResult> {
    const ctx = await requireAuthContext(); requirePermission(ctx, { lesson: ['create'] })
    const result = await scheduleLessonCore(ctx, input); revalidatePath('/dashboard/schedule'); return result
  }
  export async function rescheduleLessonAction(input: z.input<typeof rescheduleSchema>): Promise<ScheduleResult> {
    const ctx = await requireAuthContext(); requirePermission(ctx, { lesson: ['update'] })
    const result = await rescheduleLessonCore(ctx, input); revalidatePath('/dashboard/schedule'); return result
  }
  ```
- **MIRROR**: `SCHEDULE_CREATE_FULL_FLOW`, `SCHEDULE_RESCHEDULE_FULL_FLOW`, `ZOD_SCHEMA_AND_LOCAL_HELPERS`.
- **IMPORTS**: as shown. Keep whatever OTHER actions (`cancelLessonAction`, etc.) already in `actions.ts` untouched.
- **GOTCHA**: (1) Behavior must be **identical** — do not "improve" it; the existing tests (`conflict.test.ts`) exercise this path. (2) Keep `requirePermission` in the wrapper (create vs update differ), NOT in core. (3) `revalidatePath` stays ONLY in the Server-Action wrapper (it throws outside a request). (4) `import 'server-only'` in core is fine (stubbed under Vitest, allowed in the MCP route). (5) If other code imported `createSchema`/`rescheduleSchema` from `actions.ts`, re-export them or update imports.
- **VALIDATE**: `pnpm typecheck` clean; `pnpm vitest run tests/conflict.test.ts` still green (proves no drift).

### Task 3: `src/auth/mcp-context.ts` — bearer→owner `AuthContext`
- **ACTION**: `resolveMcpAuthContext()` returning the same `AuthContext` shape.
- **IMPLEMENT**:
  ```ts
  import 'server-only'
  import { and, eq } from 'drizzle-orm'
  import { db } from '@/db'
  import { member } from '@/db/schema'
  import { AuthError, type AuthContext } from '@/auth/context'
  import { env } from '@/env'

  // P6-1: MCP has no Better Auth session. Build the SAME AuthContext from the env-configured owner,
  // RE-DERIVING role from the live member row (mirrors getAuthContext) so demotion/removal revokes access.
  export async function resolveMcpAuthContext(): Promise<AuthContext> {
    const userId = env.MCP_USER_ID
    const tenantId = env.MCP_ORG_ID
    const [m] = await db.select({ role: member.role }).from(member)
      .where(and(eq(member.organizationId, tenantId), eq(member.userId, userId))).limit(1)
    if (!m) throw new AuthError('NOT_A_MEMBER')
    return { userId, tenantId, role: m.role, isPlatformAdmin: false } // NEVER platform-admin over MCP
  }
  ```
- **MIRROR**: `PRINCIPAL_DERIVATION` (the member-row role lookup).
- **IMPORTS**: as shown (`member` is re-exported from `@/db/schema` via `../auth-schema`).
- **GOTCHA**: (1) `member` is a Better-Auth **auth** table (not tenant-scoped) — reading it via raw `db` is consistent with `getAuthContext` and is the ONE allowed raw read (it's how you *derive* the tenant). All DOMAIN tables still go through `forTenant`. (2) `isPlatformAdmin` MUST be `false` (`true` bypasses ALL tenant RBAC). (3) Never accept `tenantId`/`userId` from tool args — only from env. (4) Throwing `AuthError('NOT_A_MEMBER')` (misconfigured env) is caught and surfaced by tools as `isError` content.
- **VALIDATE**: `pnpm typecheck`; covered by the DB test in Task 8.

### Task 4: `src/lib/mcp-confirm.ts` — payload-hash confirmation store
- **ACTION**: Module-scope single-use, TTL'd confirmation tokens bound to a payload hash.
- **IMPLEMENT**:
  ```ts
  import 'server-only'
  import crypto from 'node:crypto'
  const TTL_MS = 5 * 60_000
  const store = new Map<string, { payloadHash: string; expiresAt: number }>()
  export function hashPayload(o: unknown): string { return crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex') }
  export function issueConfirmation(payload: unknown, now: number = Date.now()): string {
    const token = crypto.randomUUID(); store.set(token, { payloadHash: hashPayload(payload), expiresAt: now + TTL_MS }); return token
  }
  // single-use: always consumes the token; returns true only if unexpired AND payload hash matches.
  export function consumeConfirmation(token: string, payload: unknown, now: number = Date.now()): boolean {
    const p = store.get(token); if (!p) return false; store.delete(token)
    return p.expiresAt >= now && p.payloadHash === hashPayload(payload)
  }
  ```
- **MIRROR**: `MCP_DRAFT_AND_CONFIRM`.
- **IMPORTS**: `node:crypto`.
- **GOTCHA**: (1) `store` MUST be module-scope (survives the per-request `McpServer` rebuild — P6-2 gotcha). (2) `now` is a param so tests are deterministic (`Date.now()` is fine in app runtime — the ban is workflow-scripts-only). (3) Single-instance MVP (one VPS) makes an in-process Map correct; for Phase-7 multi-instance, swap for a signed stateless token — note it. (4) Canonicalize the payload the SAME way in preview and confirm (identical object key order via `JSON.stringify` — pass the parsed+narrowed args, not the raw MCP input, to both).
- **VALIDATE**: `pnpm typecheck`; unit test in Task 8 (issue→consume ok; wrong payload/expired/reuse → false).

### Task 5: `src/mcp/message.ts` — pure parent-message composer
- **ACTION**: `composeParentMessage({ studentName, lessons, shareUrl })` → Chinese text.
- **IMPLEMENT**:
  ```ts
  import { DateTime } from 'luxon'
  import type { FeedLesson } from '@/lib/ical-feed'
  const ZONE = 'Asia/Shanghai'
  export function composeParentMessage(args: { studentName: string; lessons: FeedLesson[]; shareUrl: string }): string {
    const { studentName, lessons, shareUrl } = args
    const header = `${studentName} 近期课表：`
    if (lessons.length === 0) return `${header}\n近期暂无排课。\n完整课表：${shareUrl}`
    const lines = lessons.map((l) => {
      const s = DateTime.fromJSDate(l.startAt, { zone: 'utc' }).setZone(ZONE)
      const e = DateTime.fromJSDate(l.endAt, { zone: 'utc' }).setZone(ZONE)
      const loc = l.location ? ` · ${l.location}` : ''
      return `· ${s.toFormat('MM月dd日 EEE', { locale: 'zh' })} ${s.toFormat('HH:mm')}–${e.toFormat('HH:mm')} ${l.title ?? '课节'}${loc}`
    })
    return `${header}\n${lines.join('\n')}\n\n完整课表随时查看：${shareUrl}`
  }
  ```
- **MIRROR**: `PARENT_FACING_DATA_ASSEMBLY` (data source) + the Phase-4 `<ScheduleCard>` Luxon formatting.
- **IMPORTS**: `luxon`, `FeedLesson`.
- **GOTCHA**: (1) `FeedLesson.startAt/endAt` are UTC instants → always `setZone('Asia/Shanghai')` before formatting. (2) Keep this **pure** (no DB, no `server-only`) so it unit-tests directly. (3) It DRAFTS text only — the tutor reviews/sends manually (P6-6).
- **VALIDATE**: `pnpm typecheck`; unit test in Task 8.

### Task 6: `src/mcp/register-tools.ts` — the 8 tools
- **ACTION**: `registerCourseSchedulingTools(server)` registering read tools, the two draft-and-confirm write pairs, and `draft_parent_message`.
- **IMPLEMENT** (shape; `server` is the `McpServer` from the `createMcpHandler` callback):
  ```ts
  import 'server-only'
  import { z } from 'zod'
  import { and, eq, desc } from 'drizzle-orm'
  import { forTenant } from '@/db/tenant'
  import { classSection, course, student, note, lesson } from '@/db/schema'
  import { requirePermission } from '@/auth/authorize'
  import { AuthError } from '@/auth/context'
  import { ConflictError } from '@/lib/errors'
  import { resolveMcpAuthContext } from '@/auth/mcp-context'
  import { createSchema, rescheduleSchema, scheduleLessonCore, rescheduleLessonCore } from '@/lib/schedule-core'
  import { issueConfirmation, consumeConfirmation } from '@/lib/mcp-confirm'
  import { composeParentMessage } from '@/mcp/message'
  import { ensureActiveShare, getStudentLessonsForTenant } from '@/app/dashboard/students/share-data'
  import { cardWindow } from '@/lib/ical-feed'
  import { env } from '@/env'

  const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] })
  const fail = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true as const })
  // Map thrown domain errors to clean MCP content (never leak a stack).
  async function guard<T>(fn: () => Promise<T>, onOk: (v: T) => ReturnType<typeof ok>): Promise<ReturnType<typeof ok>> {
    try { return onOk(await fn()) }
    catch (e) {
      if (e instanceof AuthError) return fail(e.code === 'FORBIDDEN' ? '无权限执行该操作' : '认证失败')
      if (e instanceof ConflictError) return fail('时间冲突，无法保存')
      if (e instanceof z.ZodError) return fail(`参数校验失败：${e.issues.map((i) => i.message).join('；')}`)
      return fail(e instanceof Error ? e.message : '未知错误')
    }
  }

  export function registerCourseSchedulingTools(server) {
    // ---- READ: list_classes ----
    server.registerTool('list_classes',
      { title: '列出班级', description: 'List the tutor\'s class sections (with course label).', inputSchema: z.object({}) },
      async () => guard(async () => {
        const ctx = await resolveMcpAuthContext(); requirePermission(ctx, { course: ['read'] })
        const rows = (await forTenant(ctx).select(classSection)) as (typeof classSection.$inferSelect)[]
        const courses = (await forTenant(ctx).select(course)) as (typeof course.$inferSelect)[]
        const label = new Map(courses.map((c) => [c.id, c.title]))
        return rows.map((r) => ({ id: r.id, name: r.name, course: label.get(r.courseId) ?? null, teacherId: r.teacherId, capacity: r.capacity, defaultLocation: r.defaultLocation }))
      }, (list) => ok(JSON.stringify(list, null, 2))))

    // ---- READ: list_students ----
    server.registerTool('list_students',
      { title: '列出学生', description: 'List students in the tutor\'s org.', inputSchema: z.object({ status: z.enum(['active', 'inactive', 'archived']).optional() }) },
      async ({ status }) => guard(async () => {
        const ctx = await resolveMcpAuthContext(); requirePermission(ctx, { student: ['list'] })
        const rows = (await forTenant(ctx).select(student, status ? eq(student.status, status) : undefined)) as (typeof student.$inferSelect)[]
        return rows.map((s) => ({ id: s.id, name: s.name, englishName: s.englishName, schoolGrade: s.schoolGrade, status: s.status, parentWechat: s.parentWechat }))
      }, (list) => ok(JSON.stringify(list, null, 2))))

    // ---- READ: get_lesson_notes ----
    server.registerTool('get_lesson_notes',
      { title: '查看课节笔记', description: 'Get notes for a lesson.', inputSchema: z.object({ lessonId: z.string().min(1) }) },
      async ({ lessonId }) => guard(async () => {
        const ctx = await resolveMcpAuthContext(); requirePermission(ctx, { lesson: ['read'] })
        const rows = (await forTenant(ctx).select(note, and(eq(note.lessonId, lessonId)))) as (typeof note.$inferSelect)[]
        return rows.map((n) => ({ id: n.id, body: n.body, visibility: n.visibility, authorId: n.authorId, createdAt: n.createdAt }))
      }, (list) => ok(JSON.stringify(list, null, 2))))

    // ---- WRITE (draft): schedule_lesson_preview ----
    server.registerTool('schedule_lesson_preview',
      { title: '排课（预览）', description: 'Preview scheduling a lesson. Runs conflict detection. Writes NOTHING; returns a confirmationToken.', inputSchema: createSchema },
      async (rawArgs) => guard(async () => {
        const ctx = await resolveMcpAuthContext(); requirePermission(ctx, { lesson: ['create'] })
        const args = createSchema.parse(rawArgs)
        // Dry-run: reuse the SAME section lookup + conflict check as the core, without inserting.
        // (Simplest: run a preview-only variant — OR reuse checkTeacherConflict directly here.)
        // ...compute a human preview + conflicts/suggestions...
        const token = issueConfirmation(args)
        return { args, token /*, preview text */ }
      }, ({ token }) => ok(`预览已生成。确认排课请调用 schedule_lesson_confirm，confirmationToken="${token}"，并传入相同参数。`)))

    // ---- WRITE (execute): schedule_lesson_confirm ----
    server.registerTool('schedule_lesson_confirm',
      { title: '排课（确认）', description: 'Execute a previously previewed schedule.', inputSchema: createSchema.and(z.object({ confirmationToken: z.string().min(1) })) },
      async ({ confirmationToken, ...rawArgs }) => guard(async () => {
        const ctx = await resolveMcpAuthContext(); requirePermission(ctx, { lesson: ['create'] })
        const args = createSchema.parse(rawArgs)
        if (!consumeConfirmation(confirmationToken, args)) throw new Error('确认令牌无效、已过期或参数已变化，请重新调用 schedule_lesson_preview。')
        return scheduleLessonCore(ctx, args)
      }, (r) => (r.ok ? ok(`已排课：${r.event.title} ${r.event.start}`) : fail(`时间冲突。可选时段：${r.suggestions.join(' / ') || '无'}`))))

    // ---- reschedule_lesson_preview / reschedule_lesson_confirm: same pattern with rescheduleSchema + rescheduleLessonCore ----

    // ---- draft_parent_message ----
    server.registerTool('draft_parent_message',
      { title: '起草家长消息', description: 'Draft a WeChat schedule message for a student\'s parent (no send).', inputSchema: z.object({ studentId: z.string().min(1) }) },
      async ({ studentId }) => guard(async () => {
        const ctx = await resolveMcpAuthContext(); requirePermission(ctx, { student: ['read'], lesson: ['read'] })
        const s = (await forTenant(ctx).findById(student, studentId)) as typeof student.$inferSelect | null
        if (!s) throw new Error('学生不存在')
        const share = await ensureActiveShare(ctx, studentId)
        const shareUrl = `${env.NEXT_PUBLIC_APP_URL}/s/${share.token}`
        const lessons = await getStudentLessonsForTenant(ctx, studentId, cardWindow())
        return composeParentMessage({ studentName: s.name, lessons, shareUrl })
      }, (text) => ok(text)))
  }
  ```
- **MIRROR**: `RBAC_PERMISSION_CHECK`, `TENANT_SCOPED_DATA_LAYER`, `RESULT_SHAPE`, `ERROR_TAXONOMY`, `PARENT_FACING_DATA_ASSEMBLY`, `MCP_DRAFT_AND_CONFIRM`.
- **IMPORTS**: as shown.
- **GOTCHA**: (1) EVERY handler: `resolveMcpAuthContext()` → `requirePermission(ctx, …)` → parse → `forTenant`/core (the P6-4/5/6/7 order). (2) Only `visibility` is surfaced on notes — if you filter for parent-facing flows use `eq(note.visibility, 'shared')`; do NOT default-leak `internal` notes. (3) Return `{isError:true}` content for auth/conflict/validation failures — do NOT throw out of the handler (the `guard` wrapper does this). (4) For the previews, run conflict detection but DO NOT insert; bind the token to the **parsed** `args` (identical object passed to `consumeConfirmation`). (5) `list_classes` needs `capacity 1..15`, `defaultLocation`, `teacherId` from `class_section` and the label from `course` (composite FK `(tenant_id, course_id)`). (6) `note.lessonId` is nullable — `eq(note.lessonId, lessonId)` is correct. (7) `student.status` enum values are exactly `active|inactive|archived`; `lesson.status` uses American `canceled`.
- **VALIDATE**: `pnpm typecheck`; RBAC + message tested in Task 8; end-to-end in Task 10.

### Task 7: `src/app/api/[transport]/route.ts` — the MCP endpoint
- **ACTION**: Build the handler, gate it with the static bearer, export `GET`/`POST`.
- **IMPLEMENT**:
  ```ts
  import type { AuthInfo } from '@modelcontextprotocol/server' // adjust if Task 0 finds a different peer name
  import { createMcpHandler, withMcpAuth } from 'mcp-handler'
  import { registerCourseSchedulingTools } from '@/mcp/register-tools'
  import { env } from '@/env'
  export const runtime = 'nodejs'
  export const dynamic = 'force-dynamic'
  export const maxDuration = 60

  const handler = createMcpHandler(
    (server) => registerCourseSchedulingTools(server),
    { serverInfo: { name: 'course-scheduling-mcp', version: '1.0.0' }, capabilities: { tools: { listChanged: true } } },
  )
  const verifyToken = async (_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> => {
    if (!bearerToken) return undefined
    const { timingSafeEqual } = await import('node:crypto')
    const a = Buffer.from(bearerToken), b = Buffer.from(env.MCP_BEARER_TOKEN)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined
    return { token: bearerToken, clientId: 'course-scheduler', scopes: ['schedule:read', 'schedule:write'] }
  }
  const authHandler = withMcpAuth(handler, verifyToken, { required: true, resourceUrl: env.MCP_RESOURCE_URL })
  export { authHandler as GET, authHandler as POST }
  ```
- **MIRROR**: `MCP_ENDPOINT_2X`, `ROUTE_HANDLER_NEXT16`.
- **IMPORTS**: as shown.
- **GOTCHA**: (1) `runtime='nodejs'` is MANDATORY (edge can't open the pg socket / run `server-only` libs). (2) `required:true` — it defaults to **false**; without it, unauthenticated calls pass through. (3) Timing-safe compare with equal-length guard (`timingSafeEqual` throws on length mismatch). (4) Export **only** `GET`/`POST` (stateless → no `DELETE`, no Redis). (5) The `[transport]` segment is ignored by 2.x — clients POST to `/api/mcp`; optionally validate `params.transport === 'mcp'` to lock the surface. (6) `maxDuration` is a Vercel ceiling — a no-op on the self-hosted VPS (Traefik/Node timeouts govern there); harmless to keep. (7) CORS is not needed for Claude's server-side calls; only add metadata/CORS handlers if exposing to a browser OAuth client (Phase 7).
- **VALIDATE**: `pnpm typecheck`; `pnpm build` traces `mcp-handler` into `.next/standalone` (add to `serverExternalPackages` only if it complains); curl smoke in Task 10.

### Task 8: Tests — `tests/mcp-tools.test.ts`
- **ACTION**: Pure RBAC matrix + confirm-store + message composer; DB integration for `resolveMcpAuthContext` and `schedule-core`.
- **IMPLEMENT**:
  - **RBAC matrix** (pure, `can()`): `schedule_*` → `can('owner',{lesson:['create']})===true`, `can('parent',{lesson:['create']})===false`, `can('assistant',{lesson:['create']})===true`; reads → `can('assistant',{student:['list']})`/`{course:['read']}`; `reschedule_*` → `{lesson:['update']}`.
  - **confirm-store** (pure): `issueConfirmation(p)` then `consumeConfirmation(token, p)` → `true`; wrong payload → `false`; reuse (second consume) → `false`; expired (`now = issued + 6*60_000`) → `false`.
  - **message composer** (pure): fabricated `FeedLesson[]` → output contains `的课表`, `HH:mm` in Asia/Shanghai (`08:00Z` → `16:00`), the `shareUrl`; empty lessons → `近期暂无排课`.
  - **`resolveMcpAuthContext`** (DB): seed `organization`+`user`+`member(role:'owner', createdAt)`; set `env.MCP_ORG_ID`/`MCP_USER_ID` (via `process.env` before import, or refactor to read at call-time); assert `{userId, tenantId, role:'owner', isPlatformAdmin:false}`; missing member → throws `AuthError('NOT_A_MEMBER')`.
  - **`schedule-core`** (DB): mirror `conflict.test.ts` — seed org/user/member/course/section (with `teacherId`); `scheduleLessonCore(ctxFor(org,user), {sectionId, startAt, endAt})` → `{ok:true}`; overlapping call → `{ok:false, error:'CONFLICT'}`; `rescheduleLessonCore` with `excludeLessonId` self → no self-conflict.
- **MIRROR**: `TEST_STUB_AND_RBAC_MATRIX`; `tests/conflict.test.ts` fixture lifecycle.
- **IMPORTS**: `describe,it,expect` from `vitest`; `can` from `@/auth/authorize`; the new modules; `ctxFor` helper (copy verbatim per-file).
- **GOTCHA**: (1) DB suites need a live Postgres (`DATABASE_URL` in `.env`, loaded by `setupFiles:['dotenv/config']`); pure suites need none. (2) `server-only` is aliased by `vitest.config.ts` → `tests/server-only-stub.ts`, so `schedule-core`/`mcp-context` import fine. (3) Auth-table inserts (`organization`/`user`/`member`) REQUIRE `createdAt` (NOT NULL, no default). (4) `cleanup()` idempotent in `beforeAll` AND `afterAll`; delete children before parents (feature tables have no FK to `organization`). (5) For `env`-dependent `resolveMcpAuthContext`, set `process.env.MCP_ORG_ID`/`MCP_USER_ID` in the test before the module reads `env` (or seed those ids to match the fixtures). (6) `forTenant` results are loosely typed — cast with `as { … }[]`.
- **VALIDATE**: `pnpm vitest run tests/mcp-tools.test.ts` green; `pnpm test` (full suite) green.

### Task 9: Docs, secrets, PRD status
- **ACTION**: Document the new env vars; flip the PRD phase status.
- **IMPLEMENT**: Add `MCP_BEARER_TOKEN`/`MCP_ORG_ID`/`MCP_USER_ID`(/`MCP_RESOURCE_URL`) to `.env.example` if it exists (and to the Coolify deployment secrets). In the PRD table, Phase 6: `pending`→`in-progress` and PRP-Plan cell → `[plan](../plans/phase-6-claude-mcp-connector.plan.md)`.
- **IMPORTS**: n/a.
- **GOTCHA**: Generate the bearer with ≥32 chars (`openssl rand -base64 48`). Obtain `MCP_ORG_ID`/`MCP_USER_ID` once from the DB (the tutor's `member` row) — e.g. `pnpm db:studio` or a one-off select. NEVER log the token; it grants full owner access.
- **VALIDATE**: `git diff` shows the PRD row + `.env.example` updated; secrets present in the deploy target (out-of-repo).

### Task 10: Validation sweep + connector smoke
- **ACTION**: Full static/test/build gate + data-layer guard + live MCP smoke.
- **IMPLEMENT**: `pnpm check` (typecheck+lint), `pnpm test`, `pnpm build`; the data-layer grep guard; then run `pnpm dev` and exercise the endpoint.
- **IMPORTS**: n/a.
- **GOTCHA**: The MCP tool layer must NOT touch tenant tables via raw `db` — the ONLY sanctioned raw read is `member` inside `mcp-context.ts` (an auth table). See the grep in Validation Commands.
- **VALIDATE**: see **Validation Commands** below — all EXPECTs pass; a Claude connector can list, preview+confirm a lesson, and draft a message.

---

## Testing Strategy

### Unit / Integration Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| RBAC: owner schedule | `can('owner',{lesson:['create']})` | `true` | no |
| RBAC: parent schedule | `can('parent',{lesson:['create']})` | `false` | yes (deny) |
| RBAC: assistant reschedule | `can('assistant',{lesson:['update']})` | `true` | no |
| RBAC: assistant course read | `can('assistant',{course:['read']})` | `true` | no |
| confirm ok | issue(p) → consume(token,p) | `true` | no |
| confirm wrong payload | issue(p) → consume(token,p2) | `false` | yes |
| confirm reuse | consume twice | 2nd `false` | yes (single-use) |
| confirm expired | consume at issued+6min | `false` | yes (TTL) |
| message: rows | 2 `FeedLesson` (08:00Z) | contains `的课表`, `16:00`, shareUrl | no |
| message: empty | `[]` | `近期暂无排课` + shareUrl | yes (empty) |
| `resolveMcpAuthContext` ok | seeded owner member | `{role:'owner',isPlatformAdmin:false}` | no |
| `resolveMcpAuthContext` no member | wrong `MCP_USER_ID` | throws `AuthError('NOT_A_MEMBER')` | yes |
| `scheduleLessonCore` free slot | non-overlapping | `{ok:true, event}` | no |
| `scheduleLessonCore` conflict | overlapping same teacher | `{ok:false,error:'CONFLICT',suggestions}` | yes |
| `rescheduleLessonCore` self | move a lesson, `excludeLessonId=id` | `{ok:true}` (no self-conflict) | yes |
| tenant isolation | `ctxFor(orgA)` schedules into orgB section | section not found / cannot write | yes (leak) |

### Edge Cases Checklist
- [x] Empty input — no students/classes → `[]`; no upcoming lessons → `近期暂无排课`.
- [x] Invalid types — Zod `z.object` on every tool; bad args → `isError` content (not a crash).
- [x] Permission denied — `requirePermission` per tool → `AuthError('FORBIDDEN')` → `无权限` content.
- [x] Cross-tenant / leak — `tenantId` only from `resolveMcpAuthContext`; never from args; `forTenant` scopes all domain reads/writes.
- [x] Conflict (pre-check) — `{ok:false,error:'CONFLICT'}` + Asia/Shanghai `HH:mm` suggestions.
- [ ] Conflict (DB race) — GiST 23P01 → `ConflictError` → `时间冲突` content (mandatory try/catch in core; hard to unit-test the race — rely on the constraint + `isExclusionViolation`).
- [x] Draft-and-confirm bypass — write core reachable ONLY via a valid, unexpired, payload-matched `*_confirm`.
- [ ] Unauthenticated / bad bearer — `withMcpAuth` `required:true` → 401 (curl in Validation Commands).
- [x] Internal-note leak — surface only what's needed; `visibility='shared'` filter for parent-facing use.

---

## Validation Commands

### Static Analysis
```bash
pnpm typecheck
pnpm lint
```
EXPECT: Zero type errors, zero lint errors.

### Unit / Integration Tests
```bash
pnpm test                              # full suite
pnpm vitest run tests/conflict.test.ts # proves the schedule-core extraction did not drift (Task 2)
pnpm vitest run tests/mcp-tools.test.ts
```
EXPECT: All suites pass — existing (recurrence/conflict/rbac/materialize/tenant-isolation/ical-feed/schedule-card/share-slicing) + new `mcp-tools`.

### Data-layer guard (M1 — no raw db on tenant tables from the MCP layer)
```bash
grep -rEn "\bdb\.(select|insert|update|delete)\(" src/mcp src/lib/schedule-core.ts
grep -rEn "\bdb\.(select|insert|update|delete)\(" src/auth/mcp-context.ts
```
EXPECT: `src/mcp/**` and `schedule-core.ts` show **no** raw `db.*` on tenant tables (all via `forTenant`); `mcp-context.ts` shows exactly ONE raw `db.select` — the `member` (auth table) role lookup, consistent with `src/auth/context.ts`.

### Build
```bash
SKIP_ENV_VALIDATION=1 pnpm build       # env-independent build (matches Docker)
pnpm build                             # with MCP_* set → validates env at boot
```
EXPECT: Build succeeds; `mcp-handler` traced into `.next/standalone`.

### MCP endpoint (manual, dev server)
```bash
pnpm dev
# missing/bad bearer → 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
# valid bearer → tools list
curl -sN -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $MCP_BEARER_TOKEN" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
EXPECT: no bearer → `401`; valid bearer → a JSON-RPC result listing `list_classes`, `list_students`, `get_lesson_notes`, `schedule_lesson_preview`, `schedule_lesson_confirm`, `reschedule_lesson_preview`, `reschedule_lesson_confirm`, `draft_parent_message`.

### Connector smoke (Claude Code)
```bash
claude mcp add course-scheduler --transport http https://<host>/api/mcp \
  --header "Authorization: Bearer <MCP_BEARER_TOKEN>"
# then in Claude: list_students → schedule_lesson_preview → schedule_lesson_confirm → draft_parent_message
```
EXPECT: Claude lists students/classes; `schedule_lesson_preview` reports conflict-or-clear + a token; `schedule_lesson_confirm` (same args + token) writes the lesson; a conflicting time is refused with suggestions; `draft_parent_message` returns a Chinese draft + `/s/<token>` link; a **stale/mismatched** confirm token is rejected.

### Manual Validation
- [ ] Add the connector in Claude.ai (custom connector, same URL + bearer) — tools appear.
- [ ] Schedule via preview→confirm; verify the lesson shows in the dashboard calendar.
- [ ] Reschedule to a conflicting time → refused with Asia/Shanghai suggestions; to a free time → moved.
- [ ] `draft_parent_message` output pastes cleanly into WeChat; the `/s/<token>` link opens the read-only page.
- [ ] Rotate `MCP_BEARER_TOKEN` (env) → old token 401s; new token works.

---

## Acceptance Criteria
- [ ] All tasks completed.
- [ ] All validation commands pass.
- [ ] Tests written and passing (`tests/mcp-tools.test.ts`), and `tests/conflict.test.ts` still green (no extraction drift).
- [ ] No type errors, no lint errors.
- [ ] In Claude, the tutor can list classes/students, read notes, preview+confirm schedule/reschedule (with identical conflict detection), and draft a parent message (PRD Phase-6 success signal).
- [ ] Every write is draft-and-confirm; a stale/mismatched confirmation token is rejected server-side.

## Completion Checklist
- [ ] MCP tools go through `resolveMcpAuthContext` → `requirePermission` → `forTenant(ctx)` — no raw `db` on tenant tables; `isPlatformAdmin:false` always.
- [ ] Scheduling logic lives ONLY in `src/lib/schedule-core.ts`; Server Actions and MCP tools are thin wrappers (zero drift; `conflict.test.ts` proves it).
- [ ] Static bearer verified with a constant-time compare; `required:true`; secret is a server-only env (`min(32)`), never logged, never client-bundled.
- [ ] `draft_parent_message` reuses `ensureActiveShare` + `getStudentLessonsForTenant` (forTenant spine) — no new/raw data path; drafts only, no send.
- [ ] Confirmation store is module-scope, single-use, TTL'd, payload-hash-bound; multi-instance caveat documented.
- [ ] Endpoint exports only `GET`/`POST`, `runtime='nodejs'`, `dynamic='force-dynamic'`; no Redis, no `DELETE`.
- [ ] No new RBAC statements (reuse `student`/`course`/`lesson`).
- [ ] Docs/PRD phase status updated to `in-progress` with this plan linked; env vars documented.

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `mcp-handler` API/version drift vs the researched 2.x surface (package rename, signature change) | M | H | Task 0 re-verifies name/version/API against `npm view` + README before coding; imports isolated to Tasks 6/7; 1.x differences documented as fallback signals. |
| Static bearer leak → full owner access | M | H | `min(32)` server-only secret, timing-safe compare, HTTPS-only, rotate via env; audit via `clientId`; Phase-7 OAuth 2.1 + per-user tokens. |
| Confused-deputy / token passthrough | L | M | Set `resourceUrl` (audience) in `withMcpAuth`; never forward the bearer upstream; single self-contained resource. |
| Draft-and-confirm bypass (model schedules without confirming) | L | H | Write core reachable ONLY via `*_confirm` with a valid, unexpired, payload-hash-matched token — enforced server-side, not model-dependent. |
| In-process confirm store lost on restart / breaks multi-instance | M | L | Single-VPS MVP makes it correct; TTL 5 min limits exposure; documented signed-token path for Phase-7 scale-out. |
| Cross-tenant access via tool args | L | H | `tenantId` sourced ONLY from `resolveMcpAuthContext`; never accepted as an arg; `forTenant` scopes everything; tenant-isolation test. |
| `schedule-core` extraction changes behavior | M | H | Behavior-preserving move; `conflict.test.ts` re-run in Task 2 + Task 10 gates it. |
| `revalidatePath` called from MCP context throws | L | M | It stays ONLY in the Server-Action wrapper; MCP tools call `scheduleLessonCore` directly. |
| NULL `teacher_id` disables conflict protection | L | H | Core rejects a section/lesson with null `teacherId` (`班级尚未指定教师`); GiST + pre-check both key on non-null `teacher_id`. |
| Prompt injection via tool args (destructive intent) | M | M | Strict `z.object` schemas, no free-form SQL, RBAC per tool, all writes draft-and-confirm; only whitelisted read/write shapes exposed. |
| Edge runtime misconfig (no DB socket) | L | H | `export const runtime='nodejs'` on the route; validated by the connector smoke. |

## Notes
- **Parallel with Phase 5**: the only shared files are `package.json`/lockfiles, `src/env.ts`, and `src/app/dashboard/schedule/actions.ts` (a behavior-preserving refactor). Phase 5 (Progress Reports) touches `@react-pdf`/report tables — no overlap with the MCP surface. If both land together, coordinate the lockfile + `src/env.ts` merges.
- **Single source of truth preserved**: MCP only reads/writes the tutor's own Postgres through `forTenant(ctx)`; it never reads an external calendar and adds no new tenant path.
- **Zero-drift is the core design bet**: extracting `schedule-core.ts` (P6-3) means the UI and Claude produce byte-identical scheduling results and conflict feedback — the extraction is validated by re-running `conflict.test.ts`, not by new assertions alone.
- **Forward hooks (Phase 7)**: swap `resolveMcpAuthContext` (env principal) for a per-user OAuth 2.1 principal (WorkOS AuthKit, `withMcpAuth` + RFC 9728) and the tools are unchanged; replace the in-process confirm `Map` with a signed stateless token for multi-instance; add outbound-send tools (WeChat/email) on top of `draft_parent_message`; add a recurring-series tool over `materializeSection`; add a `reschedule_request` tool for parent self-service.
- **Tool naming**: the PRD lists `schedule_lesson`/`reschedule_lesson`; these ship as `*_preview` + `*_confirm` pairs because the PRD ALSO mandates draft-and-confirm for all write/outbound tools — the pair *is* the capability. Read-tool names match the PRD exactly.
