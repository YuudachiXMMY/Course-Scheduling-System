# PR Review: #21 — docs(prp): Phase 7c — MCP OAuth 2.1 plan (Better Auth mcp plugin)

**Reviewed**: 2026-09-15
**Author**: YuudachiXMMY (Jadyn Wu)
**Branch**: worktree-prp-plan-7c-mcp-oauth → main
**Decision**: COMMENT (draft PR; docs-only — plan document + PRD status flip)

## Summary

Planning artifact only — no production code. Adds `.claude/PRPs/plans/phase-7c-mcp-oauth.plan.md` (12-task plan) and flips PRD phase 7c `pending → in-progress` with the plan linked and the user-approved WorkOS→Better-Auth deviation noted. The plan is thorough, internally consistent, and honest about its residual unknowns. I verified the load-bearing codebase claims (env vars, migration numbering, dep versions) against the actual worktree — they hold. No CRITICAL/HIGH issues. A handful of LOW verify-items to fold into implementation.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM
None.

### LOW

1. **AS issuer suffix ambiguity (Task 7).** `protectedResourceHandler({ authServerUrls: [issuer] })` sets `issuer = env.BETTER_AUTH_URL` (the bare origin). Better Auth mounts under `/api/auth`, so OAuth/OIDC discovery is served at `/api/auth/.well-known/oauth-authorization-server`. If MCP clients resolve `authServerUrls` to the bare origin but the AS metadata (and its `issuer` field) lives under `/api/auth`, discovery can fail. The plan flags "verify the advertised path" for the *protected-resource* doc, but does not pin whether `authServerUrls`/issuer needs the `/api/auth` suffix. This is the single most likely implementation-time snag — pin it first (curl both `/.well-known/oauth-authorization-server` and `/api/auth/.well-known/oauth-authorization-server`, compare the `issuer` field, and set `authServerUrls` to whatever the metadata's own `issuer` returns).

2. **`customAccessTokenClaims` is load-bearing and asserted-verified (Task 2).** The entire org-claim threading design (Tasks 2 → 5 → 6) hinges on `mcp({ customAccessTokenClaims })` existing with an `async ({ user }) => claims` signature in `@better-auth/oauth-provider@1.7.4`. The plan states this was verified against the tarball; it is not independently re-verifiable from the diff. It sits in the same "verify before building" bucket as the consent-API unknown the plan already flags — recommend confirming the option name/signature in the same first pass, since a mismatch cascades through three tasks. (Fallback if absent: derive the org claim inside `requireMcpAuth`'s callback from `claims.sub` via a `member`-row lookup, instead of embedding it in the token.)

3. **Next.js `.well-known` route-folder (Task 7).** Three route handlers live under `src/app/.well-known/…`. App Router segments beginning with `.` are unusual; Next 16 does serve them, but confirm the routes actually resolve (not 404) as the first validation step for Task 7 — a silent 404 here breaks the whole discovery chain. Cheap to verify with the `curl` commands already in the plan.

## Validation Results

| Check | Result | Rationale |
|---|---|---|
| Type check | Skipped (N/A) | Diff is two markdown files; no source changed — running `tsc` validates nothing about this PR |
| Lint | Skipped (N/A) | Same — no source in the diff |
| Tests | Skipped (N/A) | Same — no source in the diff |
| Build | Skipped (N/A) | Same — no source in the diff |
| Plan-claim spot-checks | **Pass** | `env.NEXT_PUBLIC_APP_URL` (client block) + `env.BETTER_AUTH_URL` (server block) both exist in typed `env.ts` → plan's fallback exprs typecheck; last migration is `0007` → plan's `0008` is correct; `mcp-handler ^2.1.1` installed |

## Files Reviewed

- `.claude/PRPs/plans/phase-7c-mcp-oauth.plan.md` — Added (666 lines) — the plan
- `.claude/PRPs/prds/course-scheduling-system.prd.md` — Modified (1 line) — phase 7c → in-progress + plan link + deviation note

## Notes

- Correctly a draft + docs-only PR → reviewed as COMMENT, not approve/block.
- The plan's self-flagged unknowns (consent approve/deny API; Claude redirect URI; `auth:generate` CLI table detection) are appropriately scoped as implementation-time verify steps with fallbacks; the `skipConsent` trusted-client path keeps the consent unknown non-blocking for the core goal.
- Confidence in single-pass implementation: aligns with the plan's stated **8/10**, contingent on resolving LOW #1 and #2 early in the pass.
