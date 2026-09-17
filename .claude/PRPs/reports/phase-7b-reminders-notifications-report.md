# Implementation Report: Phase 7b — Reminders & Notifications

## Summary
Added a persisted, tenant-isolated **in-app notification center** plus **best-effort PWA Web Push** to the course scheduler. Two producers: (1) an idempotent **course-reminder scan** (24h + 1h before each lesson) driven by a secret-gated `POST /api/cron/reminders` route, and (2) **reschedule-outcome notifications** emitted when a teacher approves/rejects a request. Recipients are the lesson's teacher and the enrolled students' linked portal users, scoped by tenant and `portalLink`. The persisted `notification` row is the source of truth; Web Push is a best-effort enhancement that never aborts a write.

## Assessment vs Reality
| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | XL | XL (as predicted) |
| Estimated Files | ~28 (≈20 new, ≈8 modified) | 34 changed (16 new src/test + config + migration) |
| Confidence | — | High — all 5 validation levels green |

## Tasks Completed
| # | Task | Status | Notes |
|---|---|---|---|
| 1 | `notificationType` enum | ✅ | `['lesson_reminder','reschedule_approved','reschedule_rejected']` |
| 2 | `notification` table | ✅ | composite FKs (cascade), partial-unique dedupe index |
| 3 | `push_subscription` table | ✅ | bare userId, unique (tenant,endpoint) |
| 4 | Barrel + migration | ✅ | `drizzle/0010_material_justin_hammer.sql`; applied |
| 5 | `notification` permission | ✅ | `['read','list','update']` in statement + all 6 roles |
| 6 | notification-core | ✅ | create/list/unread/markRead/markAll + recipients + reschedule outcome |
| 7 | reminder-core | ✅ | `REMINDER_OFFSETS`, gt/lte window, idempotent dedupeKey |
| 8 | push-core (web-push) | ✅ | best-effort; prune on 404/410; dedupe by endpoint |
| 9 | reschedule-core hook | ✅ | approve/reject emit outcome; wrapped so a notify failure never rolls back |
| 10 | cron route | ✅ | constant-time secret gate; per-tenant try/catch; raw `db` only on `organization` |
| 11 | sw.js + push-client | ✅ | push + notificationclick; browser subscribe/unsubscribe helpers |
| 12 | push actions + button | ✅ | user-gesture opt-in; hidden when VAPID unset |
| 13 | dashboard center | ✅ | page/data/actions/panel + nav unread badge |
| 14 | portal center | ✅ | same quartet; inline nav badge (above consent gate) |
| 15 | tests (3 files) | ✅ | 10 tests; window/idempotency/dedupe/isolation/outcome |
| 16 | env/build/deploy wiring | ✅ | env.ts, next.config, docker-compose, Dockerfile, .env.example, README |

## Validation Results
| Level | Status | Notes |
|---|---|---|
| Static Analysis (typecheck) | ✅ Pass | `tsc --noEmit` zero errors |
| Lint | ✅ Pass | `eslint .` zero errors/warnings |
| Unit/Integration Tests | ✅ Pass | 10 new tests green; full suite **177 passed (26 files), no regressions** |
| Build | ✅ Pass | `next build` standalone succeeds with VAPID/CRON unset; new routes present |
| Edge Cases | ✅ Pass | dedupe, tenant isolation, foreign mark-read, window/status exclusion, empty inArray guard |

## Deviations from Plan
1. **Timezone (corrected):** the plan formatted reminder times in `Asia/Shanghai`; the project convention (and `review-panel.tsx` / `ical-feed.ts`) is to import `APP_TIME_ZONE` from `@/lib/timezone` (America/Toronto) and never hardcode a zone. Used `DateTime.fromJSDate(d, { zone: 'utc' }).setZone(APP_TIME_ZONE)` throughout.
2. **Per-recipient deep link:** reminders/outcomes set `url` to `/dashboard/notifications` for the teacher and `/portal/notifications` for portal users (decided per-recipient from `lesson.teacherId`), rather than a single fixed url — the layout role guards also self-correct a mismatch.
3. **`pnpm-lock.yaml` reconciliation:** the committed lockfile was stale vs `package.json` (missing the pre-existing `@playwright/test` dev dep). Installing web-push reconciled it; the lock diff therefore also threads `@playwright/test` peers. This is a correct pre-existing-drift fix, not feature scope.
4. **Push subscribe button:** dropped a `supported` state flag to satisfy the `react-hooks/set-state-in-effect` lint rule (setState only inside async `.then`); unsupported browsers get a graceful "cannot enable" message instead.

## Files Changed
16 new source/test files (2 schema tables, 3 cores, push-client, push-actions, subscribe button, cron route, 2×3 UI quartets, 3 tests) + 1 migration; 17 modified (enums/barrel/permissions/env/reschedule-core/sw.js/next.config/docker-compose/Dockerfile/.env.example/README/2 layouts/nav-links/smoke.spec/package.json/pnpm-lock).

## Tests Written
| Test File | Tests | Coverage |
|---|---|---|
| `tests/notification-core.test.ts` | 6 | create/list/unread, markRead ownership, dedupe, tenant isolation, markAll |
| `tests/reminder-core.test.ts` | 2 | 24h+1h window scan (teacher+parent), out-of-window/canceled exclusion, idempotency |
| `tests/reschedule-notify.test.ts` | 2 | approve → `reschedule_approved`; reject → `reschedule_rejected` (+ review note) |

## Adversarial Review + Fixes
A 3-dimension review (correctness / security-rbac / schema-integration) with per-finding adversarial verification ran over the new subsystem. Security/RBAC and schema: **no confirmed issues**. Two confirmed correctness defects in `reminder-core.ts`, both fixed:
1. **(medium) Stale reminder after reschedule** — the dedupeKey `reminder:<lesson>:<offset>:<user>` was time-invariant, so a lesson rescheduled in place (same id) regenerated the same key and the new-time reminder was suppressed. **Fix:** the key now includes `l.startAt.getTime()`, so a moved lesson gets a fresh reminder while same-scan idempotency is preserved. Regression test added (`a rescheduled lesson … gets a FRESH reminder`).
2. **(low) Identical double-fire in one scan** — a lesson started <1h out matched both the 24h and 1h windows in a single scan, producing two byte-identical reminders. **Fix:** the imminent (1h) offset now carries a distinct title (`课程即将开始` vs `课前提醒`), so the two are non-identical (the plan already deemed firing both acceptable).

Post-fix: typecheck + lint clean; reminder-core suite now 3 tests; full suite green.

## Next Steps
- [ ] Code review (an adversarial review workflow ran over the core logic — 2 findings fixed)
- [ ] Draft PR opened from the worktree branch
- [ ] Prod: set `CRON_SECRET` + VAPID keys; add the Coolify Scheduled Task (see README)
