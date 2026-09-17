# E2E spec authoring guide

How the Playwright E2E suite is wired, and the conventions every spec must follow. Read this before
writing or changing a spec.

## How it runs

```bash
npm run test:e2e            # full suite (triggers global-setup → seed + storageState)
npm run test:e2e -- --project=staff        # one project
npm run test:e2e -- tests/e2e/portal/reschedule.spec.ts   # one file
npm run test:e2e:ui        # interactive UI mode
npm run test:e2e:report    # open the last HTML report
```

`tests/e2e/global-setup.ts` runs once before everything: it (re)seeds a dedicated fixture tenant into
the app's Postgres (`scripts/seed-e2e.ts`) and signs each role in via HTTP to persist a storageState
JSON under `tests/e2e/.auth/`. The suite runs against the **real running app** on `E2E_BASE_URL`
(default `http://localhost:3000`).

Config: `E2E_BASE_URL`, `E2E_DATABASE_URL`, `E2E_BETTER_AUTH_SECRET` — set in `.env.e2e` locally
(see `.env.e2e.example`) or as env vars in CI. `E2E_SKIP_SEED=1` reuses the existing fixture (fast
iteration on specs).

## Shared backend → serial + self-contained

The whole suite shares ONE app instance and ONE database, so `playwright.config.ts` sets
`workers: 1` / `fullyParallel: false`. Consequences for spec authors:

- **Never assert on global counts** ("there are 3 students"). Assert on rows YOU created/seeded.
- **Data you create must use unique names**, e.g. `` `E2E临时学生-${Date.now()}` ``, so parallel-in-time
  or repeated runs don't collide. Prefer creating-then-asserting-your-own-row over counting.
- **Mutations of seeded fixtures**: only the dashboard reschedule-approval spec consumes
  `seed.pendingReschedule`. Don't have two specs mutate the same seeded row.
- Reversible flows (create → cancel in the same test) are preferred for portal reschedule.

## Projects & auth (storageState)

`playwright.config.ts` maps folders → projects → default storageState:

| Folder                | Project      | Default storageState |
| --------------------- | ------------ | -------------------- |
| `tests/e2e/auth/`     | `auth-flows` | none (drives login)  |
| `tests/e2e/public/`   | `public`     | none                 |
| `tests/e2e/dashboard/`| `staff`      | `owner` (all perms)  |
| `tests/e2e/portal/`   | `portal`     | `parent` (consented) |

Override the role inside a spec:

```ts
import { authStatePath } from '../fixtures/seed-constants'
test.use({ storageState: authStatePath('teacher') }) // or 'admin' / 'student' / 'parentNoConsent'
```

For cross-role in one test (parent submits, owner approves), use `contextForRole`:

```ts
import { contextForRole } from '../fixtures/test'
const ownerCtx = await contextForRole(browser, 'owner')
const ownerPage = await ownerCtx.newPage()
// ...
await ownerCtx.close()
```

## The `seed` fixture (dynamic ids)

```ts
import { test, expect } from '../fixtures/test' // NOT '@playwright/test' — this test injects `seed`

test('…', async ({ page, seed }) => {
  seed.studentA            // { id, name }   张三E2E — has lessons, share link, consented parent+student
  seed.studentB            // { id, name }   李四E2E — owns the pending reschedule request
  seed.sectionA / sectionB // { id, name, teacherId }
  seed.course              // { id, title }
  seed.lessons             // counts + studentA/BFutureLessonId + …FutureStartAt (ISO)
  seed.share               // { token, studentId, url }  → seed.share.url is `/s/<token>`
  seed.invalidShareToken   // never resolves
  seed.pendingReschedule   // { id, studentId, lessonId, requestedStartAt, requestedEndAt } | null
  seed.accounts.owner      // { email, userId, memberRole, landing } — same for admin/teacher/parent/student/parentNoConsent
})
```

Static identity (emails, password, entity names, tokens) is in `fixtures/seed-constants.ts`
(`E2E_ACCOUNTS`, `E2E_FIXTURES`, `E2E_PASSWORD`). Seeded lessons are anchored around **now**
(term = now−10d … now+6w) so they land inside the app's schedule/feed windows.

## Locators

No `data-testid` exists app-wide EXCEPT the handful added for E2E (below). **Default to Chinese
visible text**: `getByRole('button', { name: '提交申请' })`, `getByLabel('邮箱')`,
`getByText('暂无排课')`. Use the added testids only for dynamic lists / opaque widgets:

| testid                              | where                                             |
| ----------------------------------- | ------------------------------------------------- |
| `schedule-card`                     | portal + `/s/[token]` student schedule card       |
| `reschedule-lesson-select` / `-start-input` / `-end-input` / `-reason` / `-submit` | portal reschedule form |
| `reschedule-row` (`data-status`) / `reschedule-cancel` | portal "我的申请" list rows       |
| `reschedule-request` (`data-request-id`) / `reschedule-approve` / `reschedule-reject` / `reschedule-conflict` | dashboard approval queue |
| `section-select` / `calendar-event-<lessonId>` | dashboard schedule (FullCalendar)     |
| `lesson-detail-drawer` / `attendance-row` (`data-student-id`) / `lesson-cancel` | lesson detail drawer |

## Gotchas (these WILL bite you)

- **Native dialogs**: schedule create/reschedule conflicts use `window.alert`; rotate/revoke/archive/
  approve-report use `window.confirm`. Register a handler BEFORE the action or Playwright hangs:
  `page.on('dialog', (d) => d.accept())` (or `d.dismiss()` to test cancel).
- **Server Actions ≠ REST**: most mutations POST to the current page URL with a `Next-Action` header,
  not a semantic endpoint. Assert on the resulting UI change (`await expect(getByText(...)).toBeVisible()`),
  not `waitForResponse('/api/…')`. Only `/api/auth/*` (login; self-service sign-up is disabled) and
  `/api/export|reports|calendar` are real URLs.
- **Rate limiter**: Better Auth throttles `/api/auth/sign-in/*` (production). Use storageState; avoid
  UI login except in `auth/` specs (the `LoginPage` POM already retries).
- **Clipboard**: copy buttons use `navigator.clipboard`. Either grant permission
  (`test.use({ contextOptions: { permissions: ['clipboard-read', 'clipboard-write'] } })` — headless
  Chromium is often fine without) or assert the visible toast (`已复制链接` / `复制失败，请手动复制`).
- **FullCalendar** toolbar buttons have no stable role/text — use `.fc-timeGridWeek-button`,
  `.fc-dayGridMonth-button`, `.fc-next-button`, etc. Events: use `calendar-event-<lessonId>` testid.
- **Consent gate**: a freshly-provisioned portal user hits "数据处理告知与同意" on first `/portal*`
  visit. `parent`/`student` are pre-consented in the seed; `parentNoConsent` is not (for that spec).

## Known-blocked / quarantine

Wrap with `test.fixme(true, '…reason (issue #)')`, don't delete:

- **`/dashboard/reports` AI 起草** needs `ANTHROPIC_API_KEY`; without it "生成草稿" errors. Test the
  form/list/PDF-link presence; `fixme` the actual draft generation.
- **`/api/export/**`** (student PNG/ICS, section ZIP) returned 500 during recon in this env — assert
  the link/attributes exist; `fixme` asserting a 200 download until the export runtime is fixed.

## Layout

```
tests/e2e/
  fixtures/   test.ts (seed fixture + contextForRole), seed-constants.ts, seed-data.ts, e2e-config.ts
  pages/      *.page.ts  (Page Objects — reuse LoginPage; add per-area POMs here)
  auth/       login/logout (project auth-flows; self-service signup removed)
  public/     share link (project public)
  dashboard/  staff area (project staff)
  portal/     parent/student portal (project portal)
```
