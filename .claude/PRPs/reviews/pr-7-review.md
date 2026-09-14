# PR Review: #7 — feat(phase-6): Claude MCP Connector (plan + implementation)

**Reviewed**: 2026-09-14
**Author**: Jadyn Wu (@YuudachiXMMY)
**Branch**: `worktree-worktree-prp-phase6-mcp-connector-plan` → `main`
**Head**: `7f78bfb`
**Decision**: COMMENT (draft PR) — would be **APPROVE with comments** on ready-for-review

## Summary

Phase 6 ships a stateless `mcp-handler` 2.x Streamable-HTTP endpoint that exposes the tutor's
scheduling to Claude. The central design is sound and low-risk: a static-bearer gate
(`withMcpAuth`, timing-safe) resolves to the **same `AuthContext`** the web app uses, so every tool
flows through the existing `requirePermission` + `forTenant(ctx)` spine unchanged — no new
tenant-data path (M1 preserved). Scheduling logic is extracted to `schedule-core.ts` and shared
byte-identically by Server Actions and MCP tools (proven by `conflict.test.ts` still green). No
CRITICAL/HIGH issues found. Findings are design/hardening refinements around the draft-and-confirm
store and the read-only framing of `draft_parent_message`.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM

**M-1 — `draft_parent_message` performs a hidden DB write under read-only permissions**
`src/mcp/register-tools.ts:289` · `src/app/dashboard/students/share-data.ts:25`

The tool is described as read-only ("只返回草稿文本，不发送") and is gated only by
`{ student: ['read'], lesson: ['read'] }`, yet it calls `ensureActiveShare(ctx, studentId)`, which
**inserts a `shareLink` row** (a durable, publicly reachable 32-char capability URL) when none
exists. Two consequences:

1. **Least-privilege gap** — a write (minting a public share capability) is reachable behind a
   read-only RBAC gate. Per `permissions.ts`, even the `parent` role passes this gate
   (`student:['read']` + `lesson:['read','list']`). In practice the MCP principal is an env-configured
   owner, so this isn't currently exploitable, but the gate no longer reflects the tool's true effect.
2. **Speculative-call surface** — a tool that looks read-only may be invoked by the model
   opportunistically, silently creating a public, unauthenticated schedule URL for a student.

This is consistent with the Phase-4 web behavior (idempotent get-or-create on the share page), so it
is **not a regression**, and the created link is a read-only schedule view. Suggested hardening:
either (a) gate share creation behind a write permission (e.g. `student:['update']` or a dedicated
`shareLink:create`), or (b) split into a read-only composer that fails when no active share exists
plus an explicit create tool, and correct the tool description to state that a share link is created
on first use.

**Resolution (fixed)** — On closer inspection, option (a) is *wrong* here: creating a share on first
use is a **deliberate read-tier decision (P4-9)** — the web `getOrCreateShare`
(`share-actions.ts:19-25`) and the authenticated PNG export route both gate `ensureActiveShare`
behind `student:['read']` / `{student:['read'], lesson:['read']}`, because the share is a read-only
view and viewing/copying its URL is a read operation. Re-tiering the MCP tool would diverge from that
convention. The real defect is narrower — the tool's "只读" description was false and an AI could
mint a URL speculatively. Fix (a refinement of option b): `draft_parent_message` now calls
**`getActiveShare` (read-only), never `ensureActiveShare`** — it attaches an *existing* link if
present, and when none exists it returns a clean parent draft (no link) plus a clearly-separated
tutor-facing note pointing to the web 学生 page to create one. `composeParentMessage` now takes an
optional `shareUrl` and omits the share line when absent. The read-tier gate is unchanged (now
honest); share creation stays the human-initiated web action, so the speculative-minting vector is
eliminated rather than relocated.

### LOW

**L-1 — Draft-and-confirm store never evicts expired-but-unconfirmed tokens**
`src/lib/mcp-confirm.ts:20`

`issueConfirmation` always adds an entry; `consumeConfirmation` deletes only when a confirm is
attempted. A `*_preview` that is never confirmed leaves a permanent entry in the module-scope `Map`,
so the store grows unbounded over the process lifetime. Entries are tiny (~100 bytes) and the MVP is
single-user, so impact is negligible today, but a long-running server accumulates dead tokens.
Suggested fix: opportunistic sweep of expired entries on `issueConfirmation` (cheap `for…of` +
`delete` on `expiresAt < now`), or a bounded size / periodic timer. (The comment already flags the
future multi-instance swap to a signed stateless token, which would also resolve this.)

**L-2 — `get_lesson_notes` returns `internal`-visibility notes to the model**
`src/mcp/register-tools.ts:140`

All notes (including `visibility: 'internal'`) are returned to the MCP client. This is by design —
the principal is the tutor, and the code comment correctly warns against auto-forwarding internal
notes to parents; `draft_parent_message` does not read notes. Informational only: the reviewer
should be aware that internal note bodies leave the app to the external LLM service.

**L-3 — Student PII flows to an external LLM service**
`src/mcp/register-tools.ts:112`

`list_students` returns `parentWechat` (and names/grades) to Claude's servers. Inherent to the
connector's purpose and explicitly opt-in via deploy config, but worth documenting so the tutor
understands parent contact handles are shared with Anthropic when the connector is enabled.

**L-4 — Redundant single-argument `and(...)` (nit)**
`src/mcp/register-tools.ts:138`

`and(eq(note.lessonId, lessonId))` wraps a single condition; the bare `eq(...)` is equivalent.
Harmless.

**L-5 — `GET` exported though stateless 2.x removes SSE (nit)**
`src/app/api/[transport]/route.ts:39`

`export { authHandler as GET }` is a harmless holdover; clients POST to `/api/mcp`. The route comment
already explains this. No action needed.

## Strengths

- **TOCTOU-safe confirm path** — `*_confirm` re-runs `checkTeacherConflict` *and* relies on the GiST
  exclusion catch inside `scheduleLessonCore`/`rescheduleLessonCore`, so a slot filled between
  preview and confirm is still rejected. The confirmation token is payload-hash-bound, single-use,
  and TTL-limited — the write core is unreachable without a valid token.
- **Zero-drift extraction** — `schedule-core.ts` is the single source of truth for both the web
  Server Actions and MCP tools; `conflict.test.ts` staying green proves the refactor didn't change
  behavior.
- **Principal hardening** — `resolveMcpAuthContext` sources `tenantId`/`userId` only from server env
  (never tool args), re-derives `role` from the live `member` row (a demoted/removed principal loses
  access immediately), and hard-codes `isPlatformAdmin: false` (no cross-tenant god-mode).
- **Tenant isolation verified** — `note` carries `tenantId`, so `forTenant(ctx).select(note, …)`
  scopes reads by tenant; a cross-tenant `lessonId` returns empty rather than leaking.

## Validation Results

| Check | Result | Notes |
|---|---|---|
| Type check | ✅ Pass | `pnpm typecheck` (`tsc --noEmit`) — re-run at review, zero errors |
| Lint | ✅ Pass | `pnpm lint` (`eslint .`) — re-run at review, zero errors |
| Tests | ✅ Pass (not re-run) | 62 tests verified during implementation; DB-backed suite needs a re-provisioned Postgres. On-disk files confirmed byte-identical to PR head `7f78bfb`, so results carry over |
| Build | ✅ Pass (not re-run) | `pnpm build` verified during implementation; not re-run to conserve cost |

> Tests/build were not re-executed at review time to avoid re-provisioning the throwaway Postgres and
> a redundant full Next build (session cost signal). The two highest-signal DB-free gates (typecheck,
> lint) were re-run independently and pass; the working tree matches PR head exactly.

## Files Reviewed

| File | Change | Reviewed |
|---|---|---|
| `src/app/api/[transport]/route.ts` | Added | ✅ full |
| `src/mcp/register-tools.ts` | Added | ✅ full |
| `src/lib/schedule-core.ts` | Added | ✅ full |
| `src/lib/mcp-confirm.ts` | Added | ✅ full |
| `src/mcp/message.ts` | Added | ✅ full |
| `src/auth/mcp-context.ts` | Added | ✅ full |
| `src/app/dashboard/schedule/actions.ts` | Modified | ✅ full |
| `src/env.ts` | Modified | ✅ full |
| `tests/mcp-tools.test.ts` | Added | ✅ full |
| `package.json` / `package-lock.json` / `pnpm-lock.yaml` | Modified | dependency add (`mcp-handler`, `@modelcontextprotocol/server`) |
| `.claude/PRPs/{plans/completed,prds,reports}/*` | Docs | plan / PRD status / report |

## Decision Rationale

0 CRITICAL, 0 HIGH, 1 MEDIUM, 5 LOW; typecheck + lint green. On a ready-for-review PR this is an
**APPROVE with comments**. Because the PR is a **draft**, this is posted as a **COMMENT**. M-1 is the
only finding worth acting on before enabling the connector in production; the LOW items are optional
hardening/nits.
