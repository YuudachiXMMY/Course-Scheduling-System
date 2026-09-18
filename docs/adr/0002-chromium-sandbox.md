# ADR 0002 — Chromium OS sandbox for PNG export (enabled by default, env escape valve)

**Status:** Accepted (Phase 4 / review slice S2)
**Date:** 2026-09-17
**Related review finding:** SEC4 (`src/lib/browser.ts`)

## Context

`src/lib/browser.ts` runs a resident headless Chromium (via Playwright) whose only job is to
render app-generated HTML to a PNG (`renderCardPng` → `page.setContent`) for the schedule-card and
section export routes. The launch previously passed `chromiumSandbox: false`, disabling Chromium's
OS-level renderer sandbox unconditionally.

Playwright defaults `chromiumSandbox` to **false**, so historically this was the path of least
resistance for running Chromium inside a container. But the sandbox is a real containment boundary:
if a renderer were ever compromised (e.g. via a Chromium 0-day triggered by malicious content), the
sandbox is what stops it from acting with the full privileges of the app process.

Mitigating facts, verified:

- The container runs as the non-root `USER nextjs` (`Dockerfile`).
- `renderCardPng` **only** ever renders HTML produced in-process by
  `react-dom`'s `renderToStaticMarkup` (`schedule-card-render.tsx`), which HTML-escapes every
  user-controlled string (student names, lesson titles).
- It uses `page.setContent` and **never navigates to a remote or user-supplied URL** — there is no
  network/navigation surface, so the practical injection/RCE path is very low.

So this is the well-known "Playwright-in-Docker sandbox tradeoff", not a live injection path — but
"disabled unconditionally" removes a cheap layer of defence in depth for no ongoing benefit on
runtimes that *can* sandbox.

## Decision

**Enable the Chromium OS sandbox by default; provide a documented env escape valve to disable it.**

- `src/lib/browser.ts` now launches with `chromiumSandbox: env.CHROMIUM_NO_SANDBOX !== 'true'`.
  With the variable unset (the normal case), the sandbox is **on**.
- Set `CHROMIUM_NO_SANDBOX=true` **only** on a runtime that cannot grant unprivileged user
  namespaces (some hardened/locked-down containers), where the sandboxed Chromium would otherwise
  fail to launch and break PNG export entirely. This is an explicit, operator-accepted risk.

Rationale: default to the safer posture; keep an operational override so we never *hard*-break PNG
export in an environment that can't sandbox, without silently shipping the weaker default everywhere.

## Load-bearing invariants (why the residual risk is acceptable even with the valve open)

1. Chromium renders **only** app-generated, HTML-escaped markup — never remote or user-controlled URLs.
2. The process runs as a **non-root** user.
3. No page navigation occurs; content is injected via `setContent` only.

If any of these change (e.g. a feature starts navigating Chromium to external URLs), re-evaluate:
disabling the sandbox would no longer be acceptable and this ADR must be superseded.

## Operational note

Re-enabling the sandbox without unprivileged-userns support makes Chromium **fail to launch**, which
breaks both PNG export routes. Verify PNG export in the real runtime image after deploying; if it
fails to launch there and userns cannot be granted, set `CHROMIUM_NO_SANDBOX=true` for that runtime.

## Revisit when

- The runtime image / host gains (or loses) unprivileged user-namespace support, **or**
- Any of the load-bearing invariants above stops holding.
