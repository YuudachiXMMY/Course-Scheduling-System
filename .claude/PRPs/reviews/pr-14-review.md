# PR Review: #14 — fix(e2e): resolve 3 Playwright audit findings — export 500, report drafting, logout

**Reviewed**: 2026-09-15
**Author**: Jadyn Wu (YuudachiXMMY)
**Branch**: worktree-fix-e2e-findings → main
**Decision**: COMMENT (draft PR)

## Summary
Focused, low-risk fix for the three defects surfaced by the live E2E audit. All changes follow
existing codebase patterns (return-as-data mirrors `CreateSectionResult`; logout mirrors the
`authClient` usage; Playwright bundling extends the existing `serverExternalPackages` rationale).
No CRITICAL or HIGH issues. A few LOW observations and one unavoidable validation gap (Docker
rebuild not run on host).

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM
None.

### LOW

- **`report-panel.tsx:44-62` — `generate()` duplicates `run()`.** The new inline
  `startTransition` block re-implements `run()`'s try/refresh/catch, differing only in the typed
  `res.ok` branch. Acceptable given the distinct return shape, but a small `runResult(fn, onOk)`
  helper would remove the duplication. Non-blocking.

- **`actions.ts:66-81` — `updateReportNarrative` / `approveReport` still throw.** They use
  `.parse` and can surface the same opaque "Minified React error #441" in production if the core
  call throws (e.g. a DB/authorization error). The audit only exercised the draft path, so this is
  out of scope for this PR, but for consistency these two actions should eventually adopt the same
  return-as-data pattern. Lower risk since neither calls an external API.

- **`next.config.ts:16-18` — glob also matches the ICS export route.** `/api/export/**` covers
  `/api/export/student/[studentId]/ics`, which does not use Playwright. Harmless (extra traced
  files only), noted for accuracy.

## Correctness / Type Safety Notes (verified)
- `report-panel.tsx`: `startTransition`, `router`, `setErr` all in scope (hooks at lines 15-17);
  `run()` retained and still used by `ReportItem` via `onRun`. Type-coherent.
- `actions.ts`: `CreateReportResult` union returned on every path; `.safeParse` guards validation;
  core call wrapped in try/catch. Mirrors `courses/actions.ts:116` exactly.
- `next.config.ts`: `outputFileTracingIncludes` is a top-level key in Next 16.3.5 (correct;
  moved out of `experimental` in Next 15). Glob `/api/export/**` matches both PNG and ZIP routes.
- `Dockerfile`: explicit `COPY` of `playwright`/`playwright-core` is belt-and-suspenders and
  harmless; no browser binaries ship (SYSTEM chromium via `PLAYWRIGHT_CHROMIUM_PATH`).
- `logout-button.tsx`: `authClient.signOut()` → `router.push('/login')` → `router.refresh()`;
  layout guard re-runs as backstop. Correct.

## Security
- No secrets committed — `.env.example` documents `ANTHROPIC_API_KEY` as a commented placeholder.
- No injection / auth-gap / SSRF introduced. Server Actions still gated by
  `requireAuthContext` + `requirePermission`. Returning error messages as data may echo a core
  error string to the client; messages here are app-authored (e.g. missing-key notice), so no
  sensitive leakage — worth keeping in mind if core errors ever wrap DB internals.

## Validation Results

| Check | Result |
|---|---|
| Type check | Skipped — host has no `node_modules` (app runs only in Docker) |
| Lint | Skipped — same reason |
| Tests | Skipped — same reason |
| Build | Skipped — Docker image not rebuilt on host |

**Recommended before merge**: rebuild the Docker image and confirm
`/api/export/section/{id}` → 200 `application/zip` and `/api/export/student/{id}/png` →
200 `image/png`; set `ANTHROPIC_API_KEY` and verify `生成草稿` (and a readable error when unset);
click `退出登录`.

## Files Reviewed
- `.env.example` — Modified (doc `ANTHROPIC_API_KEY`)
- `Dockerfile` — Modified (COPY playwright/playwright-core)
- `next.config.ts` — Modified (outputFileTracingIncludes)
- `src/app/dashboard/layout.tsx` — Modified (render LogoutButton)
- `src/app/dashboard/logout-button.tsx` — Added
- `src/app/dashboard/reports/actions.ts` — Modified (return-as-data)
- `src/app/dashboard/reports/report-panel.tsx` — Modified (typed result handling)
