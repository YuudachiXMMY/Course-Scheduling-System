# Plan: Phase 4 — Parent Sharing & Export (WeChat-first)

## Summary

Turn Phase-2 scheduling data into three parent-facing deliverables, each sliced to **one student's own lessons**: (1) a **WeChat-friendly PNG** of the schedule (rendered by a headless Chromium at `deviceScaleFactor: 2`, large type, with an embedded QR that points at the read-only web page — the primary WeChat delivery artifact); (2) a **read-only web page** at an unguessable `/s/<token>` URL (`noindex`, no auth, PIPL data-processing notice in the footer); and (3) a **`.ics` file** (email / iPhone attachment, reusing Phase-3's `buildIcs`). A small-group **batch export** loops the same template per enrolled student and streams a `.zip` (via `archiver`) where every student's folder contains only their own child's lessons. Postgres stays the single source of truth; nothing reads an external calendar.

## User Story

As **the independent tutor**, I want **to export any one student's (or a whole small group's) schedule as a WeChat-ready image, a read-only link, and an .ics — in one click**, so that **I can send each parent their child's timetable in under 30 seconds without re-confirming times over WeChat, and each parent sees only their own child's lessons.**

## Problem → Solution

**Current state**: Phases 1–3 deliver auth + multi-tenant schema, full scheduling/conflict CRUD, a FullCalendar UI, a one-way `.ics`/`webcal` subscription feed for the *tutor's own* calendar (`src/lib/ical-feed.ts` + `/api/calendar/[token]`), and an installable PWA. There is **no parent-facing output**: no per-student view, no image to paste into WeChat, no read-only link, no batch export. Parents are still confirmed one-by-one over WeChat — the exact pain the product exists to kill.

**Desired state**: On the 学生 page, each student row has an **导出/分享** control that (a) shows a copyable `https://…/s/<token>` link (with rotate/revoke), (b) downloads a large, CJK-correct **PNG** with a scan-to-open QR, and (c) downloads a **.ics**. On the 课程 page, a section has a **批量导出** button that streams a `.zip` with `每个学生/schedule.png` + `每个学生/schedule.ics`, each sliced to that student's lessons only. Opening `/s/<token>` shows a clean, mobile-first read-only timetable (`noindex`) with a PIPL notice link. Everything is scoped so a token or a ZIP folder exposes exactly one student's non-canceled lessons in a rolling window — nothing else.

## Metadata
- **Complexity**: **Large** (~22 files: 1 schema + 1 migration, 4 lib modules, 1 public page + notice page, 3 export route handlers, 1 share-data module + 1 actions module + 1 client panel, 2 page UPDATEs, Dockerfile + next.config + package.json UPDATEs, 2 test files; new deps `playwright`, `qrcode`, `archiver` + `@types/*`).
- **Source PRD**: `.claude/PRPs/prds/course-scheduling-system.prd.md`
- **PRD Phase**: Phase 4 — Parent Sharing & Export (WeChat-first) (`pending` → `in-progress`)
- **Depends on**: Phase 2 — Core Scheduling + Conflict (**complete**). Runs **in parallel with Phase 3** (both depend only on Phase 2). Phase 3 owns the tutor's *whole-calendar* subscription feed; Phase 4 owns *per-student parent* share tokens — a **separate** table, route tree, and page. Shared files are only `package.json`/lockfiles, `src/db/schema/index.ts`, `drizzle/` numbering, `Dockerfile`, `next.config.ts`.
- **Estimated Files**: ~22 (mostly `CREATE`).
- **Research basis**: 3 external doc lookups (Playwright container/CJK, `qrcode`, `archiver`), verified 2026-09. See **External Documentation**.

---

## Reconciliation Decisions (READ FIRST — binding choices for implementation)

| # | Decision | Chosen | Rejected | Rationale |
|---|----------|--------|----------|-----------|
| P4-1 | **Share identity / access model** | A new tenant-scoped `share_link` table: `id`, `tenantId`, `studentId` (NOT NULL), `token` (32-char `nanoid`, globally unique), `label`, `revokedAt`, timestamps. **One active share per student** (partial unique index on `(tenant_id, student_id) WHERE revoked_at IS NULL`). The token IS the capability; the page carries no auth. | Reuse `calendar_feed`; derive token from ids; JWT | Mirrors `calendar_feed` (P3-1) but scoped to ONE student (a parent must see only their child — PRD). Separate table keeps the tutor's whole-schedule feed and per-student parent shares independent. Partial-unique fixes the `getOrCreate` race that `calendar_feed` only documented (mirrors `enrollment`'s `uq_enrollment_student_section`). |
| P4-2 | **Public read path = deliberate `forTenant` exception** | A `src/lib/share.ts` module resolves `token → share_link` row, then reads that student's lessons **directly via `db`** scoped by `and(eq(lesson.tenantId, row.tenantId), inArray(lesson.sectionId, sectionIds))`. No `AuthContext`, no `forTenant()`. Confined to this one file, heavily commented, takes only the resolved `row.tenantId`/`row.studentId` — never a request param. | Force through `forTenant()` | Identical to P3-2: a public capability has no principal. `share.ts` is the **second and last** sanctioned public read path (the first is `ical-feed.ts`); both are confined, comment-flagged, and scope by resolved ids. |
| P4-3 | **One inline-styled template, three renders** | A single React component `<ScheduleCard>` using **inline `style={{}}` objects** (NO Tailwind classes) lives in `src/lib/schedule-card.tsx`. The read-only page renders it directly; the PNG path renders it via `renderToStaticMarkup(<ScheduleCard/>)` wrapped in a self-contained HTML doc (with a `<style>` CJK font-family block), fed to Playwright `setContent`. | Screenshot the live `/s/<token>` page (`page.goto`); Satori/@vercel/og; two separate templates | Inline styles render identically in RSC **and** in Playwright `setContent` (Tailwind classes would NOT apply under `setContent`). `setContent` avoids self-HTTP fragility (no port/host/readiness assumptions, unit-testable). Satori/@vercel/og silently produce CJK 豆腐 (no CSS grid, 500 KB edge cap can't hold a CJK font) — PRD forbids it. |
| P4-4 | **Per-student lesson slicing** | For a student: **active** enrollments → their `sectionId`s → non-canceled `lesson` rows in those sections within a rolling window. Two windows: **card/page** = `[startOfToday, +4 weeks]` (concise, WeChat-friendly); **.ics** reuses Phase-3 `feedWindow` (`[-8w, +26w]`). | Show all lessons ever; single window | A parent wants "what's coming up," not history. `.ics` keeps the fuller subscribe-grade window (reuses `feedWindow`, no new logic). Empty roster / no upcoming lessons is a valid, tested state. |
| P4-5 | **PNG rendering engine** | `playwright` (full package) with a **singleton** `chromium` browser (memoized in `src/lib/browser.ts`) + a simple **1-at-a-time async mutex**; `newContext({ deviceScaleFactor: 2 })`; `setContent(html, {waitUntil:'domcontentloaded'})`; `await page.evaluate(() => document.fonts.ready)`; `locator('#card').screenshot()` → `Buffer`. Launch args `chromiumSandbox:false`, `--disable-dev-shm-usage`, `--disable-gpu`. | `@react-pdf` (that's Phase 5, PDF not PNG); `puppeteer`; a new browser per request | PRD mandates Playwright + CJK fonts for the WeChat card. A resident browser + concurrency cap of 1 protects the small VPS (PRD risk). Playwright already awaits `document.fonts.ready` internally; the explicit call is a harmless belt-and-suspenders for CJK. |
| P4-6 | **Runtime image → Debian + system Chromium + CJK fonts** | Change the **runtime** Docker stage from `node:24-alpine` to `node:24-slim`; `apt-get install -y chromium fonts-noto-cjk`; launch Playwright with `executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/usr/bin/chromium'`; set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in the deps/build stages so `npm ci` on alpine never tries (and fails) to download Chromium. | Stay on alpine + `apk add chromium`; `npx playwright install --with-deps` in runtime | Playwright's bundled Chromium is **not supported on alpine** (glibc/X11/fonts). System Chromium on Debian + `executablePath` is the leanest deterministic path and avoids a ~300 MB browser download in the image. `fonts-noto-cjk` is what stops 豆腐 in the PNG (PRD's #1 risk). |
| P4-7 | **`serverExternalPackages` for native-ish deps** | Add `serverExternalPackages: ['playwright', 'archiver']` to `next.config.ts` so Turbopack does not try to bundle them (they use dynamic `require`/child binaries); they load from `node_modules` at runtime and are traced into `.next/standalone`. | Let Turbopack bundle them | Playwright spawns a browser binary and archiver streams; bundling breaks their dynamic requires. Marking external keeps standalone tracing correct. `qrcode` is pure-JS and can bundle normally. |
| P4-8 | **Delivery = auth-gated route handlers returning binaries** | PNG/.ics/ZIP are served by `GET` route handlers under `src/app/api/export/**`, each calling `requireAuthContext()` + `requirePermission()`. They return `image/png` / `text/calendar` / `application/zip` with `Content-Disposition`. The dashboard UI links to them (opening the PNG in a new tab lets mobile long-press-save). | Server actions returning base64 to the client | Binary downloads belong in route handlers (clean `Content-Type`, works on mobile, no giant base64 round-trips). Actions still own share-token CRUD (`getOrCreate`/rotate/revoke). |
| P4-9 | **RBAC — reuse, don't extend** | View/copy share + export (PNG/.ics/ZIP) require `student:['read']` **and** `lesson:['read']`; create/rotate/revoke the token require `student:['update']`. No new AC statement. | Add a `shareLink` statement | Mirrors P3-8 (reuse `lesson` perms). Publishing a student's schedule maps to reading student+lesson; managing the token maps to editing the student. A dedicated statement is a Phase-7 concern. `parent`/`student` roles already have `student:['read']`/`lesson:['read','list']` — forward-compatible. |
| P4-10 | **`noindex` for `/s/<token>`** | Page exports `metadata = { robots: { index: false, follow: false } }`; **and** a `next.config.ts` `headers()` entry adds `X-Robots-Tag: noindex, nofollow` for `/s/:token*`. Footer links to `/privacy` (PIPL data-processing notice). | Rely on token unguessability alone | Belt-and-suspenders: a leaked/forwarded link must never be indexed. The PIPL notice is a PRD compliance requirement (minor data + future Claude-drafted reports). |
| P4-11 | **QR encodes the PUBLIC share URL** | `qrcode.toDataURL(\`${NEXT_PUBLIC_APP_URL}/s/${token}\`, {errorCorrectionLevel:'H', width:220, margin:1})` → data-URL embedded as `<img>` in the card. | QR encodes the .ics; QR encodes a deep link | The QR's job is "scan to open the live timetable in WeChat's browser." `H` correction survives WeChat's re-compression of shared images. |

---

## UX Design

### Before
```
┌───────────────────────────────────────────────────────────┐
│ /dashboard/students → list of students (name/grade/wechat). │
│ No per-student schedule view. No image. No link. No .ics.   │
│ Parents confirmed one-by-one over WeChat.                   │
└───────────────────────────────────────────────────────────┘
```

### After
```
┌────────────────────────────────────────────────────────────────────┐
│ /dashboard/students → each row has [导出/分享]                        │
│   • copyable https://host/s/<token>  [复制] [重新生成] [停用]         │
│   • [下载图片(PNG)]  → large CJK card w/ scan-to-open QR (WeChat)      │
│   • [下载 .ics]      → email / iPhone attachment                      │
│                                                                       │
│ /dashboard/courses → each section has [批量导出(ZIP)]                 │
│   → schedules.zip: 张三/schedule.png+.ics, 李四/schedule.png+.ics …   │
│     每个文件夹只含该学生自己的课节                                     │
│                                                                       │
│ /s/<token> (public, noindex): clean mobile timetable of ONE student's │
│   upcoming lessons; footer → 数据处理告知 (/privacy).                 │
└────────────────────────────────────────────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Send a parent the timetable | manual WeChat back-and-forth | one click → PNG (paste to WeChat) / link / .ics | < 30s; QR opens the live page |
| Parent view | none | `/s/<token>` read-only page, no login, `noindex` | one student only |
| Small-group send | N/A | section → ZIP, one folder per student | each folder = that child only |
| Link hygiene | N/A | rotate (old 404s) / revoke | 32-char token capability |
| Compliance | none | PIPL notice linked from share footer | minors + future AI reports |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/db/tenant.ts` | 1-55 | `forTenant` spine + the M1 "ONLY sanctioned tenant path" rule. P4-2 is a *documented exception* — read to write it correctly. |
| P0 | `src/lib/ical-feed.ts` | 1-83 | The P3-2 public-read exception to MIRROR exactly: `getFeedLessons(tenantId)`, `feedWindow()`, `buildIcs()`. Phase 4 **reuses `buildIcs` and `feedWindow` verbatim** for the per-student .ics. |
| P0 | `src/db/schema/calendar-feed.ts` | 1-26 | Canonical capability-token table to mirror for `share_link` (token, revokedAt, global-unique token index). |
| P0 | `src/db/schema/enrollment.ts` | 1-42 | Composite FK `(tenant_id, student_id)` + the **partial-unique-on-active** index pattern to copy for `share_link`'s one-active-per-student rule, and the enrollment→section join for slicing. |
| P0 | `src/app/dashboard/calendar/actions.ts` | 1-73 | `getOrCreateFeed`/`rotateFeed`/`revokeFeed` — the EXACT shape to mirror for `share-actions.ts`. |
| P0 | `src/app/api/calendar/[token]/route.ts` | 1-37 | Public no-auth route: `await params`, 404 on bad token, binary `Response` + headers. Mirror for the public page's data resolution and for export routes' response shape. |
| P1 | `src/app/dashboard/schedule/actions.ts` | 1-88 | Server-action canon: `requireAuthContext → requirePermission → zod.parse → forTenant → revalidatePath`; `toEvent`/`toHHmm` Luxon helpers. |
| P1 | `src/app/dashboard/schedule/enrollment-actions.ts` | 85-92 | `listSectionEnrollments` — active-enrollment query to reuse for batch (section → students). |
| P1 | `src/db/schema/student.ts` | 1-29 | `student` columns for the card (name, englishName, parentName). |
| P1 | `src/db/schema/course.ts` | 37-67 | `classSection` (name, defaultLocation) + composite-FK style for `share_link`→student. |
| P1 | `src/env.ts` | 1-16 | `NEXT_PUBLIC_APP_URL` for the QR/share URL. Add `PLAYWRIGHT_CHROMIUM_PATH` (optional, server) here. |
| P1 | `src/app/dashboard/students/page.tsx` | 1-51 | Where the per-student `<ExportPanel>` mounts; RSC + `listStudents()` pattern. |
| P1 | `src/app/dashboard/students/student-form.tsx` | 1-113 | `'use client'` + `useTransition` + `router.refresh()` idiom to mirror for `<ExportPanel>`. |
| P1 | `src/app/dashboard/calendar/feed-panel.tsx` | 1-131 | Copy-to-clipboard + rotate/revoke client UI to mirror. |
| P2 | `Dockerfile` | all | Multi-stage layout; the "PHASE 4/5 ONLY: CJK fonts" runtime line to replace (P4-6). |
| P2 | `next.config.ts` | 1-24 | Add `serverExternalPackages` (P4-7) + `headers()` (P4-10). "No `webpack()` block" rule still holds. |
| P2 | `.claude/PRPs/plans/completed/phase-3-calendar-publish-pwa.plan.md` | all | Style/format reference; the P3-* decisions this plan parallels. |
| P2 | `tests/ical-feed.test.ts` | 1-85 | Test style to mirror for `tests/schedule-card.test.ts` (pure-fn, `server-only` aliased by `tests/server-only-stub.ts`). |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Playwright container launch | `/microsoft/playwright` | `chromium.launch({ headless:true, chromiumSandbox:false, executablePath, args:['--disable-dev-shm-usage','--disable-gpu'] })`. Reuse ONE `browser`; each `newContext()` is isolated. `--disable-dev-shm-usage` is critical in containers. |
| Playwright + CJK on Debian | `/microsoft/playwright` (Docker guide) | Bundled Chromium is **not supported on alpine** → use `node:24-slim` + `apt-get install chromium fonts-noto-cjk`. Playwright already awaits `document.fonts.ready` before every screenshot; explicit call is redundant-but-safe. |
| `qrcode` API | `/soldair/node-qrcode` | `await QRCode.toDataURL(text, { errorCorrectionLevel:'H', width, margin })` returns `data:image/png;base64,…`. Ships CJS; `import QRCode from 'qrcode'` works in App Router server code. |
| `archiver` in-memory ZIP | `/archiverjs/node-archiver` | `archiver('zip',{zlib:{level:9}})`; collect `archive.on('data', c=>chunks.push(c))` + `on('end', …Buffer.concat)`; `append(buf,{name})`; `finalize()` AFTER all appends. Needs `@types/archiver` (dev). Pure-JS, no native deps. |

```
KEY_INSIGHT: node:24-alpine cannot run Playwright's Chromium; switch the runtime stage to node:24-slim + apt chromium + fonts-noto-cjk, and launch with executablePath=/usr/bin/chromium.
APPLIES_TO: Task 7 (Dockerfile), Task 4 (src/lib/browser.ts)
GOTCHA: set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 in the alpine deps/build stages so `npm ci` doesn't fail downloading a browser that isn't used at build time.

KEY_INSIGHT: Tailwind classes do NOT apply under Playwright setContent (no served stylesheet); the shared card MUST use inline style objects + an inlined <style> font block.
APPLIES_TO: Task 3 (schedule-card.tsx), Task 5 (public page), Task 6 (PNG route)
GOTCHA: put font-family: 'Noto Sans SC', system-ui, sans-serif in the wrapper <style>; the Debian image supplies the font file.

KEY_INSIGHT: archiver has no .toBuffer(); collect chunks manually and Buffer.concat on 'end'.
APPLIES_TO: Task 6 (ZIP route)
GOTCHA: finalize() must come AFTER every append(); appending post-finalize throws.

KEY_INSIGHT: reuse Phase-3 buildIcs()/feedWindow() for the per-student .ics — do not re-implement ICS.
APPLIES_TO: Task 6 (.ics route)
GOTCHA: buildIcs takes FeedLesson[]; shape the student's lessons to {id,title,startAt,endAt,location}.
```

---

## Patterns to Mirror

All snippets are verbatim from the current codebase.

### CAPABILITY_TOKEN_TABLE
```ts
// SOURCE: src/db/schema/calendar-feed.ts:7-26
export const calendarFeed = pgTable('calendar_feed', {
    id: primaryId(), tenantId: tenantId(),
    token: text('token').notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(), updatedAt: updatedAt(),
  }, (t) => [
    uniqueIndex('uq_calendar_feed_tenant_id').on(t.tenantId, t.id),
    uniqueIndex('uq_calendar_feed_token').on(t.token), // GLOBAL: public route looks up by token alone
    index('idx_calendar_feed_tenant').on(t.tenantId),
  ])
```

### PARTIAL_UNIQUE_ON_ACTIVE + COMPOSITE_FK
```ts
// SOURCE: src/db/schema/enrollment.ts:26-38
uniqueIndex('uq_enrollment_student_section')
  .on(t.tenantId, t.studentId, t.sectionId)
  .where(sql`${t.status} = 'active'`),
foreignKey({
  columns: [t.tenantId, t.studentId],
  foreignColumns: [student.tenantId, student.id],
  name: 'fk_enrollment_student',
}).onDelete('cascade'),
```

### PUBLIC_READ_EXCEPTION (no ctx — scope by RESOLVED tenantId)
```ts
// SOURCE: src/lib/ical-feed.ts:30-54
// P3-2 EXCEPTION: NO AuthContext. The token already resolved to `tenantId` (a verified capability).
// Scope STRICTLY by that tenantId — never a request param. Do NOT use forTenant() (it needs a principal).
export async function getFeedLessons(tenantId: string): Promise<FeedLesson[]> {
  const { from, to } = feedWindow()
  const rows = await db.select({ id: lesson.id, title: lesson.title, startAt: lesson.startAt, endAt: lesson.endAt, location: lesson.location })
    .from(lesson)
    .where(and(eq(lesson.tenantId, tenantId), gte(lesson.startAt, from), lt(lesson.startAt, to), ne(lesson.status, 'canceled')))
  return rows
}
```

### REUSABLE_ICS_BUILDER (import, don't reimplement)
```ts
// SOURCE: src/lib/ical-feed.ts:59-82 — reuse verbatim for the per-student .ics:
import { buildIcs, feedWindow, type FeedLesson } from '@/lib/ical-feed'
const body = buildIcs(studentLessons, { host, name: `${student.name} 的课表` })
```

### CAPABILITY_TOKEN_ACTIONS (getOrCreate / rotate / revoke)
```ts
// SOURCE: src/app/dashboard/calendar/actions.ts:24-59
export async function getOrCreateFeed(): Promise<{ token: string }> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['read'] })
  const existing = await findActiveFeed(ctx)
  if (existing) return { token: existing.token }
  const [created] = (await forTenant(ctx).insert(calendarFeed, { token: nanoid(32), label: '我的教学日历' })) as Feed[]
  revalidatePath('/dashboard/calendar')
  return { token: created.token }
}
// rotate = forTenant(ctx).update(feed, id, { token: nanoid(32) }); revoke = update(..., { revokedAt: new Date() })
```

### PUBLIC_ROUTE_HANDLER (await params, 404, binary Response)
```ts
// SOURCE: src/app/api/calendar/[token]/route.ts:7-37
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params  // Next 16: params is a Promise
  const [feed] = await db.select().from(calendarFeed)
    .where(and(eq(calendarFeed.token, token), isNull(calendarFeed.revokedAt))).limit(1)
  if (!feed) return new Response('Not found', { status: 404 })
  // ... build body ...
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/calendar; charset=utf-8', /* ... */ } })
}
```

### AUTH_GATED_SERVER_ACTION
```ts
// SOURCE: src/app/dashboard/students/actions.ts:20-32
export async function createStudent(input: CreateStudentInput) {
  const ctx = await requireAuthContext()               // verified principal + tenant
  requirePermission(ctx, { student: ['create'] })      // RBAC guard at top
  const data = createStudentSchema.parse(input)        // validate + trim
  const [row] = await forTenant(ctx).insert(student, { name: data.name /* tenantId injected */ })
  revalidatePath('/dashboard/students')
  return row
}
```

### CLIENT_TRANSITION_UI (copy / rotate / revoke)
```tsx
// SOURCE: src/app/dashboard/calendar/feed-panel.tsx:16-54 + student-form.tsx:14-35
const [pending, startTransition] = useTransition()
const router = useRouter()
function rotate() {
  if (!window.confirm('重新生成后，旧链接会立即失效。确定继续？')) return
  startTransition(async () => { await rotateShare(studentId); router.refresh() })
}
async function copy(url: string) { try { await navigator.clipboard.writeText(url); setMsg('已复制链接') } catch { setMsg('复制失败') } }
```

### LUXON_ZONE_WINDOWING
```ts
// SOURCE: src/lib/ical-feed.ts:22-28 (feedWindow) — for the shorter card window:
export function cardWindow(now = new Date()): { from: Date; to: Date } {
  const n = DateTime.fromJSDate(now).setZone('Asia/Shanghai')
  return { from: n.startOf('day').toUTC().toJSDate(), to: n.plus({ weeks: 4 }).endOf('day').toUTC().toJSDate() }
}
```

### TEST_STRUCTURE (Vitest pure-fn; server-only aliased)
```ts
// SOURCE: tests/ical-feed.test.ts:1-2,29-39
import { describe, it, expect } from 'vitest'
import { renderScheduleCardHtml, type CardData } from '@/lib/schedule-card'
// build fabricated CardData → assert HTML contains student name, lesson rows, <img src="data:image/png"> QR, font-family.
```
> `tests/server-only-stub.ts` + `vite-tsconfig-paths` (see `vitest.config.ts`) let modules with `import 'server-only'` load under Vitest. Keep `renderScheduleCardHtml` a **pure** string builder (no DB, no Playwright) so it's unit-testable — exactly as `buildIcs` is separated from `getFeedLessons`.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `package.json` (+ both lockfiles) | UPDATE | Add `playwright`, `qrcode`, `archiver`; dev `@types/qrcode`, `@types/archiver`. |
| `src/db/schema/share-link.ts` | CREATE | `share_link` table (P4-1). |
| `src/db/schema/index.ts` | UPDATE | `export * from './share-link'` (before `./relations`). |
| `drizzle/0003_*.sql` (+ `meta/`) | CREATE | Generated migration for `share_link`. |
| `src/lib/share.ts` | CREATE | Public read exception (P4-2): `getShareByToken`, `getStudentScheduleForShare(tenantId, studentId)`. |
| `src/lib/schedule-card.tsx` | CREATE | Inline-styled `<ScheduleCard>` + pure `renderScheduleCardHtml(data)` (P4-3). |
| `src/lib/browser.ts` | CREATE | Playwright singleton + mutex + `renderCardPng(html): Buffer` (P4-5). |
| `src/lib/qr.ts` | CREATE | `qrDataUrl(url): Promise<string>` (P4-11). |
| `src/app/dashboard/students/share-data.ts` | CREATE | `server-only` `ensureActiveShare(ctx, studentId)`, `getActiveShare(ctx, studentId)`, `getStudentLessonsForTenant(ctx, studentId, window)`. |
| `src/app/dashboard/students/share-actions.ts` | CREATE | `getOrCreateShare` / `rotateShare` / `revokeShare` server actions (P4-9). |
| `src/app/dashboard/students/export-panel.tsx` | CREATE | `'use client'` copy/rotate/revoke + download links. |
| `src/app/dashboard/students/page.tsx` | UPDATE | Mount `<ExportPanel student={s} share={…}/>` per row. |
| `src/app/dashboard/courses/page.tsx` | UPDATE | Add per-section **批量导出(ZIP)** link. |
| `src/app/api/export/student/[studentId]/png/route.ts` | CREATE | Auth-gated PNG (P4-8). |
| `src/app/api/export/student/[studentId]/ics/route.ts` | CREATE | Auth-gated `.ics` (reuses `buildIcs`). |
| `src/app/api/export/section/[sectionId]/route.ts` | CREATE | Auth-gated ZIP (P4-8). |
| `src/app/s/[token]/page.tsx` | CREATE | Public read-only page, `noindex` (P4-2/P4-10). |
| `src/app/s/[token]/not-found.tsx` | CREATE | 404 UI for bad/revoked token (avoid leaking auth semantics). |
| `src/app/privacy/page.tsx` | CREATE | PIPL data-processing notice (P4-10). |
| `next.config.ts` | UPDATE | `serverExternalPackages` (P4-7) + `headers()` `X-Robots-Tag` for `/s/:token*` (P4-10). |
| `src/env.ts` | UPDATE | Add optional server `PLAYWRIGHT_CHROMIUM_PATH`. |
| `Dockerfile` | UPDATE | Runtime → `node:24-slim` + `chromium` + `fonts-noto-cjk`; `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in deps/build (P4-6). |
| `src/auth/permissions.ts` | (NO CHANGE) | P4-9 reuses `student`/`lesson` perms — verify only. |
| `tests/schedule-card.test.ts` | CREATE | Unit tests for `renderScheduleCardHtml` + `cardWindow`. |
| `tests/share-slicing.test.ts` | CREATE | Unit test the pure section→lesson slicing helper (fabricated rows). |

## NOT Building
- **Parent/student login, self-service reschedule** — Phase 7. Parents get read-only export/link only.
- **Two-way sync / reading external calendars** — one-way publish only (PRD "NOT Building").
- **PDF reports / Claude drafting** — Phase 5 (`@react-pdf`). This phase is PNG/link/.ics only.
- **Reminders / notifications (email/SMS/WeChat push)** — Phase 7.
- **Screenshotting the live page via `page.goto`** — rejected in P4-3 (self-HTTP fragility); use `setContent`.
- **A new RBAC statement for shares** — reuse `student`/`lesson` perms (P4-9).
- **Sharing the whole tenant via one token** — that's Phase 3's `calendar_feed`. Phase-4 tokens are per-student.
- **Multi-page / paginated cards** — a single card lists the rolling 4-week window; long lists scroll on the web page and truncate-with-"+N 更多" on the PNG.

---

## Step-by-Step Tasks

### Task 0: Dependencies + lockfile sync
- **ACTION**: Add `playwright`, `qrcode`, `archiver` to `dependencies`; `@types/qrcode`, `@types/archiver` to `devDependencies`.
- **IMPLEMENT**: `pnpm add playwright qrcode archiver` + `pnpm add -D @types/qrcode @types/archiver`.
- **GOTCHA**: Repo maintains **both** `pnpm-lock.yaml` (local) and `package-lock.json` (CI/Docker `npm ci`). After `pnpm add`, run `npm install --package-lock-only` to sync `package-lock.json` — a drift here sank PR #4. Commit **both**. Do NOT let a Chromium download run during `pnpm add` block CI: it's fine locally; the Docker build sets `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` (Task 7).
- **VALIDATE**: `pnpm install` clean; `npm install --package-lock-only` shows no further drift; `git diff` touches both lockfiles.

### Task 1: `share_link` schema + migration
- **ACTION**: Create `src/db/schema/share-link.ts`; export from barrel; generate migration.
- **IMPLEMENT**:
  ```ts
  import { pgTable, text, timestamp, index, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core'
  import { sql } from 'drizzle-orm'
  import { primaryId, tenantId, createdAt, updatedAt } from './_helpers'
  import { student } from './student'

  // P4-1: per-student, revocable capability. The public page (src/app/s/[token]/page.tsx) resolves a
  // token to this row and reads THAT student's lessons WITHOUT an AuthContext (P4-2, via src/lib/share.ts).
  export const shareLink = pgTable('share_link', {
      id: primaryId(),
      tenantId: tenantId(),
      studentId: text('student_id').notNull(),
      token: text('token').notNull(),          // 32-char nanoid capability; unguessable; rotatable
      label: text('label'),
      revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
      createdAt: createdAt(), updatedAt: updatedAt(),
    }, (t) => [
      uniqueIndex('uq_share_link_tenant_id').on(t.tenantId, t.id),
      uniqueIndex('uq_share_link_token').on(t.token), // GLOBAL: public page looks up by token alone
      // One ACTIVE share per student (mirror enrollment M6); revoked rows don't block re-issue.
      uniqueIndex('uq_share_link_active_student').on(t.tenantId, t.studentId).where(sql`${t.revokedAt} is null`),
      foreignKey({
        columns: [t.tenantId, t.studentId],
        foreignColumns: [student.tenantId, student.id],
        name: 'fk_share_link_student',
      }).onDelete('cascade'),
      index('idx_share_link_tenant_student').on(t.tenantId, t.studentId),
    ])
  ```
  Add `export * from './share-link'` to `src/db/schema/index.ts` (before `./relations`).
- **MIRROR**: CAPABILITY_TOKEN_TABLE + PARTIAL_UNIQUE_ON_ACTIVE + COMPOSITE_FK.
- **GOTCHA**: `uq_share_link_token` is a **global** unique index (public page has no tenant context). The partial-unique on `(tenant_id, student_id) WHERE revoked_at IS NULL` is what prevents `getOrCreate` races (better than `calendar_feed`, which only documented the race).
- **VALIDATE**: `pnpm db:generate` → `drizzle/0003_*.sql` with the table + 3 indexes + FK; `pnpm typecheck` passes. **Coordinate the migration number with Phase 3** if run concurrently (0002 is taken; Phase 3 may also add — pick the next free integer).

### Task 2: Public read exception (`src/lib/share.ts`)
- **ACTION**: `getShareByToken(token)` (row or null) + `getStudentScheduleForShare(tenantId, studentId, window)` returning `FeedLesson[]`, plus the shared **pure** slicing helper.
- **IMPLEMENT**:
  ```ts
  import 'server-only'
  import { and, eq, gte, lt, ne, inArray, isNull } from 'drizzle-orm'
  import { db } from '@/db'
  import { shareLink, enrollment, lesson } from '@/db/schema'
  import { type FeedLesson, feedWindow } from '@/lib/ical-feed'

  export async function getShareByToken(token: string) {
    const [row] = await db.select().from(shareLink)
      .where(and(eq(shareLink.token, token), isNull(shareLink.revokedAt))).limit(1)
    return row ?? null
  }

  // P4-2 EXCEPTION: NO AuthContext. `tenantId`/`studentId` come from a token-resolved shareLink row
  // (a verified capability) — NEVER from a request param. Scope strictly by them. Do NOT use forTenant().
  // This is the SECOND (and last) sanctioned public read path; confined to this file (cf. ical-feed.ts).
  export async function getStudentScheduleForShare(
    tenantId: string, studentId: string, window = feedWindow(),
  ): Promise<FeedLesson[]> {
    const secs = await db.select({ sectionId: enrollment.sectionId }).from(enrollment)
      .where(and(eq(enrollment.tenantId, tenantId), eq(enrollment.studentId, studentId), eq(enrollment.status, 'active')))
    const sectionIds = secs.map((s) => s.sectionId)
    if (sectionIds.length === 0) return []
    const rows = await db.select({ id: lesson.id, title: lesson.title, startAt: lesson.startAt, endAt: lesson.endAt, location: lesson.location })
      .from(lesson)
      .where(and(eq(lesson.tenantId, tenantId), inArray(lesson.sectionId, sectionIds),
                 gte(lesson.startAt, window.from), lt(lesson.startAt, window.to), ne(lesson.status, 'canceled')))
    return rows
  }
  ```
- **MIRROR**: PUBLIC_READ_EXCEPTION; import `feedWindow`/`FeedLesson` from `ical-feed.ts`.
- **IMPORTS**: drizzle ops incl. `inArray`, `isNull`; `db`; `shareLink`, `enrollment`, `lesson`; `feedWindow`, `FeedLesson`.
- **GOTCHA**: (1) Empty active-enrollment set → `inArray([])` is invalid SQL; **early-return `[]`** (done above). (2) Never accept `studentId` from the URL — only from the resolved `shareLink` row.
- **VALIDATE**: `pnpm typecheck`; slicing covered by `tests/share-slicing.test.ts` (Task 12, via a pure helper extracted for the section-filter step).

### Task 3: Shared card template (`src/lib/schedule-card.tsx`)
- **ACTION**: A pure `renderScheduleCardHtml(data): string` + an inline-styled `<ScheduleCard>` React component (P4-3).
- **IMPLEMENT**:
  ```tsx
  import { renderToStaticMarkup } from 'react-dom/server'
  import { DateTime } from 'luxon'
  const ZONE = 'Asia/Shanghai'

  export interface CardLesson { id: string; title: string | null; startAt: Date; endAt: Date; location: string | null }
  export interface CardData {
    studentName: string; subtitle?: string; qrDataUrl?: string; shareUrl?: string
    lessons: CardLesson[]; note?: string
  }

  function fmt(d: Date) { return DateTime.fromJSDate(d, { zone: 'utc' }).setZone(ZONE) }

  export function ScheduleCard({ data }: { data: CardData }) {
    const rows = data.lessons.slice(0, 12) // PNG cap; web page shows all (see Task 5)
    return (
      <div id="card" style={{ width: 720, boxSizing: 'border-box', padding: 32, background: '#ffffff',
        fontFamily: "'Noto Sans SC', system-ui, sans-serif", color: '#171717' }}>
        <div style={{ fontSize: 30, fontWeight: 700 }}>{data.studentName} 的课表</div>
        {data.subtitle && <div style={{ fontSize: 18, color: '#525252', marginTop: 4 }}>{data.subtitle}</div>}
        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.length === 0 && <div style={{ fontSize: 20, color: '#737373' }}>近期暂无排课</div>}
          {rows.map((l) => {
            const s = fmt(l.startAt), e = fmt(l.endAt)
            return (
              <div key={l.id} style={{ display: 'flex', gap: 16, fontSize: 22, borderBottom: '1px solid #e5e5e5', paddingBottom: 10 }}>
                <div style={{ minWidth: 210, fontWeight: 600 }}>{s.toFormat('MM月dd日 EEE', { locale: 'zh' })}</div>
                <div style={{ minWidth: 130 }}>{s.toFormat('HH:mm')}–{e.toFormat('HH:mm')}</div>
                <div style={{ flex: 1 }}>{l.title ?? '课节'}{l.location ? ` · ${l.location}` : ''}</div>
              </div>
            )
          })}
          {data.lessons.length > rows.length && <div style={{ fontSize: 18, color: '#737373' }}>+{data.lessons.length - rows.length} 节更多，请扫码查看完整课表</div>}
        </div>
        {data.qrDataUrl && (
          <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={data.qrDataUrl} width={132} height={132} alt="扫码查看课表" />
            <div style={{ fontSize: 16, color: '#525252' }}>微信扫码查看/收藏完整课表</div>
          </div>
        )}
      </div>
    )
  }

  // PURE — no DB, no Playwright. Wrap in a self-contained doc with a CJK font-family block (P4-3).
  export function renderScheduleCardHtml(data: CardData): string {
    const body = renderToStaticMarkup(<ScheduleCard data={data} />)
    return `<!doctype html><html lang="zh-Hans"><head><meta charset="utf-8">
      <style>*{margin:0;padding:0}body{font-family:'Noto Sans SC',system-ui,sans-serif}</style>
      </head><body>${body}</body></html>`
  }
  ```
- **MIRROR**: LUXON_ZONE_WINDOWING (UTC→Asia/Shanghai). Inline styles ONLY (P4-3 — Tailwind won't apply under `setContent`).
- **GOTCHA**: (1) `renderToStaticMarkup` is from `react-dom/server` — server-only, fine in a lib. (2) Lessons are UTC instants → always `setZone('Asia/Shanghai')` before formatting (mirror `ical-feed`'s Luxon note). (3) Use plain `<img>` (not `next/image`) — this HTML is fed to Playwright, not Next's renderer; add the eslint-disable line.
- **VALIDATE**: `pnpm typecheck`; `tests/schedule-card.test.ts` (Task 12).

### Task 4: Playwright singleton + PNG (`src/lib/browser.ts`)
- **ACTION**: Memoized `getBrowser()`, a 1-at-a-time mutex, `renderCardPng(html): Promise<Buffer>`.
- **IMPLEMENT**:
  ```ts
  import 'server-only'
  import { chromium, type Browser } from 'playwright'
  import { env } from '@/env'

  let browserP: Promise<Browser> | null = null
  function getBrowser(): Promise<Browser> {
    if (!browserP) {
      browserP = chromium.launch({
        headless: true, chromiumSandbox: false,
        executablePath: env.PLAYWRIGHT_CHROMIUM_PATH || undefined, // Debian system chromium in prod; bundled in dev
        args: ['--disable-dev-shm-usage', '--disable-gpu'],
      })
    }
    return browserP
  }

  // Small VPS guard (PRD risk): serialize screenshots through one browser.
  let queue: Promise<unknown> = Promise.resolve()
  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(fn, fn)
    queue = run.catch(() => {})
    return run
  }

  export function renderCardPng(html: string): Promise<Buffer> {
    return withLock(async () => {
      const browser = await getBrowser()
      const context = await browser.newContext({ deviceScaleFactor: 2 })
      try {
        const page = await context.newPage()
        await page.setContent(html, { waitUntil: 'domcontentloaded' })
        await page.evaluate(() => document.fonts.ready) // CJK belt-and-suspenders (Playwright also awaits internally)
        return await page.locator('#card').screenshot({ type: 'png' })
      } finally {
        await context.close() // close context, KEEP the browser resident
      }
    })
  }
  ```
- **IMPORTS**: `chromium`, `Browser` from `playwright`; `env`.
- **GOTCHA**: (1) NEVER `browser.close()` per request — memoize (P4-5). (2) Always `context.close()` in `finally` to avoid leaks. (3) `executablePath` empty → Playwright's bundled Chromium (dev/macOS); in Docker it's `/usr/bin/chromium` via `PLAYWRIGHT_CHROMIUM_PATH` (Task 6/7). (4) `screenshot()` returns a Node `Buffer`.
- **VALIDATE**: `pnpm typecheck`; runtime check in Task 6 validation (curl the PNG route).

### Task 5: QR helper (`src/lib/qr.ts`)
- **ACTION**: `qrDataUrl(url): Promise<string>`.
- **IMPLEMENT**:
  ```ts
  import 'server-only'
  import QRCode from 'qrcode'
  export function qrDataUrl(url: string): Promise<string> {
    return QRCode.toDataURL(url, { errorCorrectionLevel: 'H', width: 220, margin: 1 })
  }
  ```
- **GOTCHA**: `qrcode` ships CJS; `import QRCode from 'qrcode'` works in App Router server code. The share token is ASCII → no URL-encoding needed. `H` correction survives WeChat's image recompression (P4-11).
- **VALIDATE**: `pnpm typecheck`; returns a `data:image/png;base64,…` string.

### Task 6: Share data + actions + export routes
- **ACTION**: `share-data.ts` (server-only reads/ensure), `share-actions.ts` (`'use server'` CRUD), and 3 export route handlers.
- **IMPLEMENT**:
  - `src/app/dashboard/students/share-data.ts`:
    ```ts
    import 'server-only'
    import { and, eq, isNull, gte, lt, ne, inArray } from 'drizzle-orm'
    import { nanoid } from 'nanoid'
    import { forTenant } from '@/db/tenant'
    import { db } from '@/db'
    import { shareLink, enrollment, lesson } from '@/db/schema'
    import type { AuthContext } from '@/auth/context'
    import type { FeedLesson } from '@/lib/ical-feed'
    type Share = typeof shareLink.$inferSelect

    export async function getActiveShare(ctx: AuthContext, studentId: string): Promise<Share | null> {
      const rows = (await forTenant(ctx).select(shareLink, and(eq(shareLink.studentId, studentId), isNull(shareLink.revokedAt)))) as Share[]
      return rows[0] ?? null
    }
    export async function ensureActiveShare(ctx: AuthContext, studentId: string): Promise<Share> {
      const existing = await getActiveShare(ctx, studentId)
      if (existing) return existing
      const [created] = (await forTenant(ctx).insert(shareLink, { studentId, token: nanoid(32) })) as Share[]
      return created
    }
    // Authenticated slice (mirrors share.ts's public slice but on the forTenant spine, per M1).
    export async function getStudentLessonsForTenant(ctx: AuthContext, studentId: string, window: { from: Date; to: Date }): Promise<FeedLesson[]> {
      const secs = (await forTenant(ctx).select(enrollment, and(eq(enrollment.studentId, studentId), eq(enrollment.status, 'active')))) as (typeof enrollment.$inferSelect)[]
      const ids = secs.map((s) => s.sectionId)
      if (ids.length === 0) return []
      const rows = (await forTenant(ctx).select(lesson, and(inArray(lesson.sectionId, ids), gte(lesson.startAt, window.from), lt(lesson.startAt, window.to), ne(lesson.status, 'canceled')))) as (typeof lesson.$inferSelect)[]
      return rows.map((r) => ({ id: r.id, title: r.title, startAt: r.startAt, endAt: r.endAt, location: r.location }))
    }
    ```
  - `src/app/dashboard/students/share-actions.ts` — mirror `calendar/actions.ts`: `getOrCreateShare(studentId)` (req `student:['read']`), `rotateShare(studentId)` (req `student:['update']`, `update(..., { token: nanoid(32) })`), `revokeShare(studentId)` (req `student:['update']`, `update(..., { revokedAt: new Date() })`). `revalidatePath('/dashboard/students')`.
  - `src/app/api/export/student/[studentId]/png/route.ts`:
    ```ts
    import { requireAuthContext } from '@/auth/context'
    import { requirePermission } from '@/auth/authorize'
    import { forTenant } from '@/db/tenant'
    import { student } from '@/db/schema'
    import { ensureActiveShare, getStudentLessonsForTenant } from '@/app/dashboard/students/share-data'
    import { renderScheduleCardHtml } from '@/lib/schedule-card'
    import { renderCardPng } from '@/lib/browser'
    import { qrDataUrl } from '@/lib/qr'
    import { cardWindow } from '@/lib/ical-feed' // (add cardWindow next to feedWindow — see Task 6 note)
    import { env } from '@/env'
    export const runtime = 'nodejs'
    export const dynamic = 'force-dynamic'
    export async function GET(_req: Request, { params }: { params: Promise<{ studentId: string }> }) {
      const ctx = await requireAuthContext()
      requirePermission(ctx, { student: ['read'], lesson: ['read'] })
      const { studentId } = await params
      const s = (await forTenant(ctx).findById(student, studentId)) as typeof student.$inferSelect | null
      if (!s) return new Response('Not found', { status: 404 })
      const share = await ensureActiveShare(ctx, studentId)
      const shareUrl = `${env.NEXT_PUBLIC_APP_URL}/s/${share.token}`
      const lessons = await getStudentLessonsForTenant(ctx, studentId, cardWindow())
      const html = renderScheduleCardHtml({ studentName: s.name, subtitle: s.schoolGrade ?? undefined, qrDataUrl: await qrDataUrl(shareUrl), shareUrl, lessons })
      const png = await renderCardPng(html)
      return new Response(png, { status: 200, headers: { 'Content-Type': 'image/png', 'Content-Disposition': `inline; filename="schedule-${studentId}.png"`, 'Cache-Control': 'private, no-store' } })
    }
    ```
  - `src/app/api/export/student/[studentId]/ics/route.ts`: same auth; `const lessons = await getStudentLessonsForTenant(ctx, studentId, feedWindow())`; `const body = buildIcs(lessons, { host: new URL(env.NEXT_PUBLIC_APP_URL).host, name: \`${s.name} 的课表\` })`; return `text/calendar; charset=utf-8`, `Content-Disposition: attachment; filename="schedule-<id>.ics"`.
  - `src/app/api/export/section/[sectionId]/route.ts` (ZIP): auth `student:['read'], lesson:['read']`; verify section belongs to tenant (`forTenant(ctx).findById(classSection, sectionId)`); load active enrollments → students; for each student build `{png, ics}` (reuse the helpers above, **serialized** via `renderCardPng`'s internal mutex); `archiver('zip',{zlib:{level:9}})`, append `${safeName}/schedule.png` + `${safeName}/schedule.ics`, collect chunks, `finalize()`; return `application/zip`, `attachment; filename="section-<id>.zip"`.
    ```ts
    // archiver collect-to-Buffer (no .toBuffer()):
    const chunks: Buffer[] = []
    const zip = archiver('zip', { zlib: { level: 9 } })
    zip.on('data', (c: Buffer) => chunks.push(c))
    const done = new Promise<Buffer>((res, rej) => { zip.on('end', () => res(Buffer.concat(chunks))); zip.on('error', rej) })
    for (const st of students) { zip.append(pngByStudent[st.id], { name: `${safe(st.name)}/schedule.png` }); zip.append(icsByStudent[st.id], { name: `${safe(st.name)}/schedule.ics` }) }
    await zip.finalize()
    const buf = await done
    ```
- **NOTE**: Add `cardWindow(now)` (Task 3's LUXON snippet) to `src/lib/ical-feed.ts` next to `feedWindow` — keep all window helpers in one place; export it. `safe(name)` = replace `[/\\:*?"<>|]` with `_` and trim (sanitize ZIP entry names).
- **MIRROR**: CAPABILITY_TOKEN_ACTIONS, AUTH_GATED_SERVER_ACTION, PUBLIC_ROUTE_HANDLER, REUSABLE_ICS_BUILDER.
- **GOTCHA**: (1) Export routes are **authenticated** — they use `forTenant`/`getStudentLessonsForTenant` (NOT the public `share.ts` reader; M1 forbids raw `db` on the authenticated path). (2) `Cache-Control: private, no-store` on the PNG (per-student data, no shared caches). (3) `archiver.finalize()` AFTER all `append()` (research gotcha). (4) `inArray([])` is invalid — the helpers early-return `[]`. (5) The ZIP builds each student's PNG through the shared mutex → serialized; note in UI that a large group may take a few seconds.
- **VALIDATE**: `pnpm typecheck`; `curl -i -b <session-cookie> http://localhost:3000/api/export/student/<id>/png` → `200 image/png`; open it → CJK renders (no 豆腐) with QR; `.ics` route → `BEGIN:VCALENDAR`; ZIP route → valid zip, one folder per student, each `.ics` contains only that student's UIDs.

### Task 7: Public share page + not-found + privacy notice
- **ACTION**: `src/app/s/[token]/page.tsx` (RSC, `noindex`), `not-found.tsx`, `src/app/privacy/page.tsx`.
- **IMPLEMENT**:
  ```tsx
  // src/app/s/[token]/page.tsx
  import type { Metadata } from 'next'
  import Link from 'next/link'
  import { notFound } from 'next/navigation'
  import { forTenant } from '@/db/tenant' // NOT used here — see note
  import { getShareByToken, getStudentScheduleForShare } from '@/lib/share'
  import { db } from '@/db'
  import { student } from '@/db/schema'
  import { and, eq } from 'drizzle-orm'
  import { ScheduleCard } from '@/lib/schedule-card'
  export const dynamic = 'force-dynamic'
  export const metadata: Metadata = { robots: { index: false, follow: false } }

  export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params
    const share = await getShareByToken(token)
    if (!share) notFound()
    // Public read exception (P4-2): scope student lookup by the RESOLVED tenantId+studentId, never a param.
    const [s] = await db.select().from(student).where(and(eq(student.tenantId, share.tenantId), eq(student.id, share.studentId))).limit(1)
    if (!s) notFound()
    const lessons = await getStudentScheduleForShare(share.tenantId, share.studentId)
    return (
      <main style={{ maxWidth: 760, margin: '0 auto', padding: 16 }}>
        <ScheduleCard data={{ studentName: s.name, subtitle: s.schoolGrade ?? undefined, lessons }} />
        <footer style={{ marginTop: 24, fontSize: 12, color: '#737373' }}>
          本页仅供查看，链接可能随时更新。<Link href="/privacy">数据处理告知</Link>
        </footer>
      </main>
    )
  }
  ```
  - `not-found.tsx`: minimal 中文 "链接无效或已停用" page.
  - `privacy/page.tsx`: static 中文 PIPL notice — what data is stored (学生姓名/课表), that future 课程报告 may be drafted via Claude API, contact, and that shares are read-only + revocable.
- **GOTCHA**: (1) `/s/[token]` is OUTSIDE `dashboard/` → the auth-guard layout never wraps it; the root layout DOES (fine — no auth there; `<ServiceWorkerRegister/>` is harmless). (2) `notFound()` renders `not-found.tsx` (no login redirect — P4-2). (3) The student lookup here is a **deliberate public read** — comment it; it scopes by the resolved `share.tenantId`, matching `share.ts`. (4) `robots` metadata + the `next.config` `X-Robots-Tag` (Task 8) together enforce `noindex`.
- **VALIDATE**: Visit `/s/<token>` (logged out) → shows the student's upcoming lessons, no 豆腐, footer link works; bad token → "链接无效"; `curl -sI /s/<token>` shows `X-Robots-Tag: noindex` (after Task 8); page `<head>` has `<meta name="robots" content="noindex, nofollow">`.

### Task 8: `next.config.ts` — externals + noindex header
- **ACTION**: Add `serverExternalPackages` and a `headers()` block.
- **IMPLEMENT**:
  ```ts
  serverExternalPackages: ['playwright', 'archiver'],
  async headers() {
    return [{ source: '/s/:token*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }]
  },
  ```
  (Add alongside existing `experimental.serverActions`; keep `output:'standalone'`, no `webpack()` block.)
- **GOTCHA**: `serverExternalPackages` (stable in Next 15/16; NOT the old `experimental.serverComponentsExternalPackages`) stops Turbopack from bundling Playwright/archiver so their dynamic requires/child binaries work and they're traced into `.next/standalone` (P4-7). `qrcode` bundles fine (leave it out).
- **VALIDATE**: `pnpm build` succeeds; `curl -sI /s/x` shows the header; the standalone server can launch Playwright.

### Task 9: `src/env.ts` — Chromium path
- **ACTION**: Add optional `PLAYWRIGHT_CHROMIUM_PATH` to `server`.
- **IMPLEMENT**: in `server: { … }` add `PLAYWRIGHT_CHROMIUM_PATH: z.string().optional()`.
- **GOTCHA**: Optional so local dev (bundled Chromium, empty var) and prod (`/usr/bin/chromium`) both validate. `env` is imported by `browser.ts` (Task 4).
- **VALIDATE**: `pnpm typecheck`; app boots without the var set.

### Task 10: Dockerfile — Debian runtime + Chromium + CJK fonts
- **ACTION**: Switch the **runtime** stage to Debian, install `chromium` + `fonts-noto-cjk`, set `PLAYWRIGHT_CHROMIUM_PATH`; add `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` to deps/build stages.
- **IMPLEMENT** (edit `Dockerfile`):
  - In `deps` and `build` stages, before `npm ci`/`npm run build`: `ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` (build never launches a browser; runtime uses system Chromium).
  - Replace the runtime base + the "PHASE 4/5 ONLY" comment:
    ```dockerfile
    FROM node:24-slim AS runtime
    WORKDIR /app
    ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
        PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium
    RUN apt-get update && apt-get install -y --no-install-recommends \
          chromium fonts-noto-cjk \
        && fc-cache -f \
        && rm -rf /var/lib/apt/lists/*
    RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m nextjs
    # ... existing COPY --from=build lines (standalone, static, public, migrate.mjs, drizzle, entrypoint) ...
    USER nextjs
    # ... EXPOSE / HEALTHCHECK / ENTRYPOINT unchanged ...
    ```
- **GOTCHA**: (1) `node:24-slim` uses `apt`/`useradd` (not alpine `apk`/`adduser`) — update the user-creation line. (2) Node_modules built on alpine copy fine to Debian for pure-JS deps + Playwright-with-system-Chromium (we skip the bundled browser). (3) `fc-cache -f` after installing fonts so Chromium sees Noto CJK (PRD requirement). (4) Keep the `--no-install-recommends` + `rm -rf /var/lib/apt/lists/*` to stay lean. (5) **Alternative** (documented, not chosen): keep `deps`/`build` on alpine, run `npx playwright install --with-deps chromium` in a Debian runtime — heavier image, avoids `executablePath`. We chose system Chromium for leanness (P4-6).
- **VALIDATE**: `docker build .` succeeds; `docker run` → hit `/api/export/student/<id>/png` → PNG renders CJK correctly (the real 豆腐 gate); image size reasonable.

### Task 11: Dashboard UI — export panel + section batch
- **ACTION**: `export-panel.tsx` (client) mounted per student; a **批量导出** link per section.
- **IMPLEMENT**:
  - `src/app/dashboard/students/export-panel.tsx` (`'use client'`, mirror `feed-panel.tsx`): props `{ studentId, token }` (token may be null). Buttons: **生成/复制分享链接** (`getOrCreateShare` → copy `${origin}/s/${token}`), **重新生成** (`rotateShare` + confirm), **停用** (`revokeShare` + confirm), plus anchor links **下载图片** → `/api/export/student/${studentId}/png` (`target="_blank"`) and **下载 .ics** → `/api/export/student/${studentId}/ics`. Use `useTransition` + `router.refresh()`.
  - `src/app/dashboard/students/page.tsx`: for each student, fetch its active share (`getActiveShare(ctx, s.id)`) and render `<ExportPanel studentId={s.id} token={share?.token ?? null} />`. (Batch the reads or accept N small queries — single-tutor scale.)
  - `src/app/dashboard/courses/page.tsx`: per section, add `<a href={\`/api/export/section/${section.id}\`}>批量导出(ZIP)</a>`.
- **MIRROR**: CLIENT_TRANSITION_UI; `feed-panel.tsx` layout/classes (Tailwind is fine HERE — this is the dashboard, not the Playwright card).
- **GOTCHA**: (1) Compute the share origin from `NEXT_PUBLIC_APP_URL` (server) passed as a prop, or `window.location.origin` client-side — don't hardcode. (2) Download anchors don't need JS; keep them plain `<a>` so mobile long-press-save works on the PNG. (3) Confirm before rotate/revoke (`window.confirm` — dashboard, not a dialog-sensitive page).
- **VALIDATE**: Students page shows per-row export controls; copy works; PNG/.ics download; section ZIP downloads.

### Task 12: Tests
- **ACTION**: `tests/schedule-card.test.ts` + `tests/share-slicing.test.ts` (both pure, no DB/Playwright).
- **IMPLEMENT**:
  - `schedule-card.test.ts`: `renderScheduleCardHtml({...})` output contains the student name + `的课表`, a row per lesson with `HH:mm` in Asia/Shanghai (08:00Z → `16:00`), the `<img src="data:image/png` when `qrDataUrl` set, the `Noto Sans SC` font-family, and the `+N 节更多` line when `lessons.length > 12`. Empty lessons → `近期暂无排课`. `cardWindow(now)` → `from < to`, ~4 weeks apart, Asia/Shanghai day edges.
  - `share-slicing.test.ts`: extract the pure section-filter step (given `enrollments` + `lessons`, return the sliced set) into a small exported pure helper and assert only active-section, non-canceled, in-window lessons survive; empty active set → `[]`.
- **GOTCHA**: `renderScheduleCardHtml` imports nothing DB-bound and `react-dom/server` works under Node/Vitest; `cardWindow`/`feedWindow` live in `ical-feed.ts` which has `import 'server-only'` — already aliased by `tests/server-only-stub.ts` (see `vitest.config.ts`). Keep Playwright/qrcode/archiver OUT of unit tests (integration-only).
- **VALIDATE**: `pnpm test` — new files green alongside existing suites.

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| Card shape | CardData w/ 2 lessons | contains `张三 的课表`, 2 rows, `16:00` (08:00Z) | no |
| Card QR | CardData w/ qrDataUrl | `<img src="data:image/png` present | no |
| Card font | any | `font-family` includes `Noto Sans SC` | yes (CJK) |
| Card truncation | 15 lessons | 12 rows + `+3 节更多` | yes (max size) |
| Card empty | 0 lessons | `近期暂无排课`, no rows | yes (empty) |
| `cardWindow` | now | `from<to`, ~4 weeks, Asia/Shanghai edges | yes |
| Slice: active only | mix active/dropped enrollments | only active-section lessons | yes |
| Slice: canceled/window | mix | canceled + out-of-window excluded | yes |
| Slice: no enrollments | [] | `[]` (no `inArray([])`) | yes (empty) |

### Edge Cases Checklist
- [x] Empty input — no enrollments / no upcoming lessons → valid empty card + empty `.ics` + `[]` slice.
- [x] Maximum size — card caps at 12 rows + "+N 更多"; web page shows all; `.ics` bounded by `feedWindow`.
- [x] Invalid types — Zod on the token actions; routes only read a string `studentId`/`token` + verify tenant ownership.
- [ ] Concurrent access — `renderCardPng` mutex serializes screenshots (VPS guard); `ensureActiveShare` protected by the partial-unique index (a race throws 23505 → retry-or-read; single-tutor makes it rare — document).
- [x] Permission denied — export/view gated by `student:['read']`+`lesson:['read']`; rotate/revoke by `student:['update']`.
- [x] Cross-tenant / leak — token → its own tenant+student only; export routes verify the student belongs to `ctx.tenant`; ZIP folders each contain one student.
- [ ] CJK 豆腐 — the real gate is the Docker image (Task 10): render a PNG with a Chinese name and eyeball it.

---

## Validation Commands

### Static Analysis
```bash
pnpm typecheck
pnpm lint
```
EXPECT: Zero type errors, zero lint errors.

### Unit Tests
```bash
pnpm test
```
EXPECT: All suites pass — existing (recurrence/conflict/rbac/materialize/tenant-isolation/ical-feed) + new `schedule-card`, `share-slicing`.

### Database / Migration
```bash
pnpm db:generate          # creates drizzle/000N_*.sql for share_link (coordinate N with Phase 3)
# in a DB-enabled env (docker compose up postgres):
pnpm db:migrate
```
EXPECT: Migration generated; applies cleanly; `share_link` present with `uq_share_link_token` + partial-unique `uq_share_link_active_student` + FK.

### Export routes (manual, dev server, logged in)
```bash
pnpm dev
# with a valid session cookie:
curl -i -b 'better-auth.session_token=<t>' http://localhost:3000/api/export/student/<id>/png  # 200 image/png
curl -i -b '...' http://localhost:3000/api/export/student/<id>/ics                             # 200 text/calendar
curl -i -b '...' http://localhost:3000/api/export/section/<sid> -o out.zip && unzipx out.zip   # per-student folders
```
EXPECT: PNG opens with correct CJK + QR; `.ics` has `BEGIN:VCALENDAR` + only that student's UIDs; ZIP has one folder per student, each sliced.

### Public page (manual, logged OUT)
```bash
curl -sI http://localhost:3000/s/<token>          # X-Robots-Tag: noindex, nofollow
```
EXPECT: `/s/<token>` renders the student's upcoming lessons (no 豆腐), footer → /privacy; bad token → not-found; `noindex` present.

### Docker / CJK (the 豆腐 gate)
```bash
docker build -t css:phase4 .
docker run --rm -p 3000:3000 --env-file .env css:phase4
# hit the PNG route → open the image → Chinese renders, not boxes
```
EXPECT: Image builds on `node:24-slim`; Playwright launches system Chromium; PNG shows Noto CJK glyphs.

### Manual Validation
- [ ] Export a student PNG → paste into WeChat → readable, QR scans to `/s/<token>`.
- [ ] Rotate the token → old `/s/<old>` 404s; new link works.
- [ ] Revoke → link 404s.
- [ ] Batch-export a small group → each parent's folder has only their child's lessons.
- [ ] Open `/s/<token>` on a phone → mobile-friendly; footer notice link works.

---

## Acceptance Criteria
- [ ] All tasks completed.
- [ ] All validation commands pass.
- [ ] Tests written and passing (`tests/schedule-card.test.ts`, `tests/share-slicing.test.ts`).
- [ ] No type errors, no lint errors.
- [ ] One-click export of a student/small-group; WeChat shows the image; parents open the read-only page; batch ZIP is per-child (PRD Phase-4 success signal).
- [ ] CJK renders correctly in the PNG inside the Docker image.

## Completion Checklist
- [ ] Code follows discovered patterns (capability-token table/actions, server-only reads, auth-gated routes, inline-styled card).
- [ ] The **one new** `forTenant` exception (`src/lib/share.ts` + the share page's student lookup) is confined, scoped strictly by resolved `share.tenantId`/`studentId`, and heavily commented (P4-2) — the second and last such path after `ical-feed.ts`.
- [ ] Per-student slicing correct on BOTH paths (public `share.ts` and authenticated `share-data.ts`); each parent sees only their child.
- [ ] `.ics` reuses `buildIcs`/`feedWindow` (no ICS reimplementation); UIDs stay PK-derived.
- [ ] Playwright browser is a resident singleton with a concurrency guard; contexts closed per request.
- [ ] Both lockfiles synced (PR #4 lesson); `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in deps/build.
- [ ] `/s/<token>` is `noindex` (metadata + `X-Robots-Tag`) with a PIPL notice link.
- [ ] No new RBAC statement (reuse `student`/`lesson`, P4-9).
- [ ] Docs/PRD phase status updated to `in-progress` with this plan linked.

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| CJK renders as 豆腐 in the PNG | H | H | `node:24-slim` + `fonts-noto-cjk` + `fc-cache`; `font-family:'Noto Sans SC'`; `document.fonts.ready`; Docker 豆腐 gate in validation (Task 10). |
| Playwright can't launch (alpine/missing Chromium) | M | H | Debian runtime + system Chromium via `executablePath`/`PLAYWRIGHT_CHROMIUM_PATH` (P4-6); documented alternative (`playwright install --with-deps`). |
| Cross-student leak (parent sees another child) | L | H | Token→one student; both slice paths filter by resolved `studentId`; export routes verify tenant ownership; ZIP folders per student; slicing unit-tested. |
| Playwright OOM/CPU on small VPS | M | M | Resident singleton + 1-at-a-time mutex; `--disable-dev-shm-usage`; contexts closed; ZIP serializes per student (PRD risk mitigation). |
| WeChat blocks the share link | M | M | PNG (no domain trust needed) is the primary deliverable + embedded QR; link is secondary; HK/no-redirect domain (deploy concern). |
| Migration number / barrel clash with Phase 3 | M | M | Coordinate `drizzle/000N` numbering + `index.ts` export order; separate tables (`share_link` vs `calendar_feed`) → no schema overlap. |
| `serverExternalPackages` mis-set → Playwright not in standalone | M | H | Mark `playwright`+`archiver` external (P4-7); Docker run gate confirms launch in the built image. |
| `ensureActiveShare` race → 23505 on partial-unique | L | L | Single-tutor makes it rare; catch unique-violation → re-read the active row; documented. |

## Notes
- **Parallel with Phase 3**: shared files are only `package.json`/lockfiles, `src/db/schema/index.ts`, `drizzle/` numbering, `Dockerfile`, `next.config.ts`. Phase 3 already shipped `ical-feed.ts` (`buildIcs`/`feedWindow`) which this phase **reuses** — if 3 and 4 land together, ensure `ical-feed.ts` exists first (it does — Phase 3 is complete). Add `cardWindow` there without touching `feedWindow`.
- **Single source of truth preserved**: this phase only *publishes* per-student Postgres data outward (PNG/link/.ics); it never reads or trusts any external calendar.
- **Two-templates-avoided**: the inline-styled `<ScheduleCard>` is the ONE visual template — rendered directly on the web page and via `renderToStaticMarkup` for the PNG (P4-3). No Tailwind in the card (won't apply under `setContent`); Tailwind is used only in the dashboard export UI.
- **Second public read path**: after this phase there are exactly TWO `forTenant` exceptions — `src/lib/ical-feed.ts` (tenant feed) and `src/lib/share.ts` (per-student share). Both are confined, comment-flagged, and scope by resolved ids. Any third should trigger a rethink (a general capability layer).
- **Forward hooks**: `share_link.label` + the per-student model let Phase 7 issue parent-login-scoped or expiring shares without a migration. The PIPL `/privacy` page is the seed for Phase 7's fuller 服务条款/家长告知.
```
