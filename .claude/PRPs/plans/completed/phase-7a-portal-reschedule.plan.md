# Plan: Phase 7a — Team/Parent/Student Logins + Reschedule-Request Workflow

## Summary

Turn the solo tutor tool into a small **multi-user product** by adding a **login portal for `parent` / `student` roles** and a **reschedule-request → teacher-approval workflow**. Parents/students are **provisioned** by the tutor (no self-signup, WeChat-friendly no-email accounts), log in through the existing Better-Auth credential flow, land on a **new `/portal`** that shows **only their own child's / their own** upcoming schedule, and can **submit a reschedule request** (propose a new time + reason). The tutor/assistant reviews pending requests in the dashboard and **approves** (which moves the lesson through the **existing byte-identical `rescheduleLessonCore`** conflict path) or **rejects** them. A new domain **`portalLink`** table links a Better-Auth `user` to the `student` row(s) they may see (the schema gap that blocks per-child scoping today), and the reserved **`rescheduleRequest`** table (already in the DB) gains a `studentId` so a request records which child it is for. The existing `/privacy` data-processing notice is extended for minors' guardian consent + the new authenticated write path, and consent is stamped at first portal login.

This is **Phase 7a** — the first, most self-contained slice carved out of the PRD's XL "Phase 7" convergence bucket. Reminders, MCP OAuth 2.1, Google two-way sync, iCloud CalDAV, and payments are split into follow-up phases 7b–7e (see **PRD Update**).

## User Story

As **a parent (or an older student)**, I want **to log in, see my child's / my own upcoming lessons, and request a reschedule with a reason — and as the tutor, to review and approve/reject those requests in one place**, so that **families stop pinging me on WeChat to change times, every requested change is captured with an audit trail, and approving it moves the lesson with the same conflict-safety as the dashboard.**

## Problem → Solution

**Current state**: Phases 1–6 ship auth + multi-tenant schema, scheduling/conflict CRUD, one-way `.ics` + PWA, parent PNG/link export, AI progress reports, and an MCP connector. But **every account is an `owner`**: Better-Auth's `user.create.after` hook (`src/auth/auth.ts:24-41`) gives **every** newly created user their **own fresh organization + `owner` member** — there is no path to add a user to an *existing* org as a `parent`/`student`. Parents reach a schedule only through an **unauthenticated, read-only** capability link (`/s/[token]`); there is **no login, no per-child scoping, and no write path**. The `parent`/`student` RBAC roles and the `rescheduleRequest` table/enum are **declared but unused** (Phase-1 forward-stability), and **no `user`↔`student` link exists anywhere** — so a logged-in parent cannot be resolved to their child. Reschedule "requests" happen entirely over WeChat.

**Desired state**: The tutor provisions a `parent`/`student` account for a student from the dashboard (name + optional login id + password; a placeholder email is synthesized for WeChat-only parents). That user logs in at `/login` and is dispatched to **`/portal`**, which renders **only** the linked student's upcoming lessons (reusing the Phase-4 `getStudentLessonsForTenant` + `ScheduleCard` pipeline on the authenticated `forTenant` spine). From `/portal/reschedule` they pick an upcoming lesson, propose a new time + reason, and **create a `rescheduleRequest`** (status `pending`). The tutor sees pending requests at **`/dashboard/reschedule`** and **approves** (→ `rescheduleLessonCore(ctx, {id, startAt, endAt})` moves the lesson, same `checkTeacherConflict` + GiST backstop as the calendar UI; request → `approved`, `reviewedBy`/`reviewedAt` stamped) or **rejects** (→ `rejected`). Every write is gated by the **existing RBAC verbs** (`rescheduleRequest: ['create'|'cancel']` for parent/student, `['approve'|'reject']` for teacher/admin/owner) **plus a new row-level ownership check** (the acting user must be linked to the student, and the student must be actively enrolled in the lesson's section). PIPL minor-consent is captured once at first portal login.

## Metadata
- **Complexity**: **Large → XL** (~24 files: schema + migration, auth hook branch, provisioning, a new `reschedule-core`, portal route group + pages, dashboard review UI, privacy/consent, env, 3 test files, PRD split). **Recommended to land as two PRs** — PR-1: schema + provisioning + RBAC + reschedule-core + tests (server-side, headless-testable); PR-2: portal UI + teacher review UI + consent (pages/components). The task list is ordered so PR-1 = Tasks 0–8, PR-2 = Tasks 9–15.
- **Source PRD**: `.claude/PRPs/prds/course-scheduling-system.prd.md`
- **PRD Phase**: **Phase 7 → split into 7a (this) + 7b–7e**; Phase 7a `pending` → `in-progress` (see **PRD Update**).
- **Depends on**: Phases 2 (scheduling core), 3/4 (share-data + `ScheduleCard`), and the Phase-1 auth/RBAC skeleton — **all complete on `main`**.
- **Estimated Files**: ~24 (7 CREATE schema/lib, ~9 CREATE UI/actions, ~6 UPDATE, 3 test).
- **Research basis**: 1 external doc source — **Better Auth 1.7.4** admin + organization plugin APIs (`better-auth.com/docs`), captured below. ⚠ Version-sensitive; **Task 0 re-verifies against `node_modules/better-auth` before coding.**

---

## Reconciliation Decisions (READ FIRST — binding choices for implementation)

| # | Decision | Chosen | Rejected | Rationale |
|---|----------|--------|----------|-----------|
| **P7a-1** | **How to provision a `parent`/`student` account** | An owner/admin-only Server Action `provisionPortalAccount` that: (1) synthesizes a unique placeholder email `portal_<nanoid>@${PORTAL_EMAIL_DOMAIN}` when no real email is given; (2) `auth.api.createUser({ body: { email, password, name } })` (admin plugin) to mint a **credential** user; (3) `auth.api.addMember({ body: { userId, role, organizationId: ctx.tenantId } })` to add them to **the tutor's org** as `parent`/`student`; (4) `forTenant(ctx).insert(portalLink, { studentId, userId, relationship })` to record the domain link. | (a) `organization.inviteMember`/`createInvitation` (email-required, needs a mail transport — bad for WeChat parents); (b) raw `user`+`account`+`member` inserts (manual scrypt password hashing — fragile); (c) baking role/tenant into a token. | `addMember` is the **only** primitive that adds an existing user to an existing org with a role and **no email round-trip** (server-only, trusted). `createUser` mints the credential account server-side. `member.role='parent'/'student'` reuses the pre-declared RBAC matrix verbatim. `user.email` is `NOT NULL UNIQUE` and email/password is the only provider, so a synthesized placeholder is the leanest no-email path. |
| **P7a-2** | **Stop portal users from getting their own tenant** | **Branch the `user.create.after` hook** so it auto-creates an org **only** for the self-signup endpoint (`context.path === '/sign-up/email'`); admin-provisioned portal users are skipped and get **no junk org**, so `session.create.before` deterministically resolves their single membership (the tutor's org). | Let the hook run then delete the junk org; add a junk org + rely on `session.create.before` picking the right one (it has **no `ORDER BY`** — nondeterministic). | The hook currently fires for **every** user creation incl. `createUser`. A skipped hook = the portal user has exactly one membership (the tutor's), so `activeOrganizationId` is unambiguous and `getAuthContext` resolves the correct tenant + role. **Task 0 verifies** the `after(user, context)` second-arg shape in the installed 1.7.4; **fallback**: declare a `user.additionalFields` boolean `isPortalUser` and branch on `user.isPortalUser`. |
| **P7a-3** | **Model the `user`↔`student` link** | A **new domain table `portalLink`** (`src/db/schema/portal-link.ts`, migration `0006`), mirroring `enrollment`/`share_link`: `id, tenantId, studentId (composite FK → student, cascade), userId (bare text, NO FK — auth-owned), relationship (enum 'parent'|'student'), consentedAt (nullable), createdAt, updatedAt`; `uniqueIndex(tenantId, studentId, userId)` + covering `idx_*_tenant_user` / `idx_*_tenant_student`. | (a) a nullable `student.userId` column (only models student-self, not a parent with several children); (b) reusing `member` alone (RBAC verb only, no per-child binding); (c) an auth-schema FK (auth tables are Better-Auth-owned). | A join table cleanly supports **one parent ↔ many children** AND **student-self**, is the exact shape the codebase already uses (`enrollment`), and `student` is already an FK target (`uq_student_tenant_id`). `userId` stays bare text (matches `class_section.teacherId`, `attendance.recordedBy`, etc.). |
| **P7a-4** | **Which child a reschedule request is for** | **Add `studentId` to `rescheduleRequest`** (migration `0006`): `student_id text` + composite FK `[tenantId, studentId] → student` (cascade), + `idx_reschedule_tenant_student`. Every portal request carries the child. | Restrict portal reschedule to capacity-1 (1:1) sections only. | A lesson belongs to a section holding up to **15** students (`ck_section_capacity`), so a lesson-only request can't say *whose* reschedule it is — breaking per-child authz + the teacher's context. Small groups are a real PRD case; recording `studentId` is the correct, minimal fix. |
| **P7a-5** | **"Parent sees only their own child" (row-level scope)** | Introduce the codebase's **first beyond-tenant row scope**: a portal data layer resolves the acting user's linked `studentId`s via `portalLink` (`userId = ctx.userId`, tenant-scoped), then reuses `getStudentLessonsForTenant(ctx, studentId, cardWindow())`. Reschedule **create** re-verifies: acting user is linked to `studentId` **and** the student has an **active enrollment** in the lesson's section. | Rely on `forTenant(ctx)` alone (tenant-scoped only — would leak **every** family's data within the org); pass `studentId` from the client unchecked. | `forTenant` isolates tenants, **not** users within a tenant. There is zero row-level precedent, so the portal must add + test it explicitly. Ownership is derived from the trusted `portalLink` + `enrollment`, never from a request param. |
| **P7a-6** | **Reschedule-request workflow shape** | A new `src/lib/reschedule-core.ts` modeled on **report-core**: `createRescheduleRequestCore` / `approveRescheduleRequestCore` / `rejectRescheduleRequestCore` / `cancelRescheduleRequestCore`, wrapped by thin Server Actions. **Approve** calls the existing `rescheduleLessonCore(ctx, { id, startAt, endAt })`, inspects its `ScheduleResult`, and only on `{ok:true}` flips the request to `approved` (else keeps it `pending` and surfaces the conflict). | MCP-style tool; duplicate the lesson-move logic; a single fire-and-forget approve. | Reusing `rescheduleLessonCore` guarantees **byte-identical** conflict semantics with the calendar UI + MCP. The report-core create→approve state machine (with a custom `approve` permission verb) is the exact precedent. Cores exclude `requireAuthContext`/`revalidatePath` (request-coupled) so they're headless-testable like `report-core`. |
| **P7a-7** | **RBAC changes** | **None to `permissions.ts`** — the `rescheduleRequest` statement + role matrix is already declared (parent/student `['create','read','list','cancel']`; teacher/admin/owner `['approve','reject']` etc.). New actions call `requirePermission(ctx, { rescheduleRequest: [...] })` **and** the P7a-5 row check. | Add new statements/roles/verbs. | The matrix is forward-stable by design (Phase-1 comment). Hardening = **row-level ownership on top of the existing verbs**, not new verbs. |
| **P7a-8** | **Routing / portal shell** | Make `/` a **role dispatcher** (parent/student → `/portal`, everyone else → `/dashboard`); change the login redirect from `/dashboard` to `/`. New `src/app/portal/{layout,page}.tsx` + `/portal/reschedule` with a **role-gated** layout, a minimal nav, and a **sign-out** button (`authClient.signOut`). Teacher review UI at `/dashboard/reschedule`. Self-signup (`/signup`) is left for the owner but **not linked** from the portal. | One shared `/dashboard` shell for all roles (leaks owner nav/data to parents); a second login page. | The dashboard nav + data are owner/teacher-oriented; a parent must never see them. A dedicated `/portal` group with its own layout is the smallest correct separation. The root dispatcher keeps a single `/login`. |
| **P7a-9** | **Minor consent / data-processing notice** | Extend the existing `/privacy` page (add minor/guardian-consent, retention, legal basis, and the authenticated write-path clauses) and add a **one-time consent gate** at first portal login that stamps `portalLink.consentedAt`. | A separate `/terms` route; informational-only (no capture); a heavyweight consent table. | PIPL + minors' data warrants **captured** consent, but the leanest capture is a timestamp on the existing link row + reuse of the existing `/privacy` route the share page already links. |
| **P7a-10** | **Env** | Add `PORTAL_EMAIL_DOMAIN: z.string().min(1).default('portal.local')` to `src/env.ts` `server:`. | Hard-code the placeholder domain. | Matches the `.optional()`/`.default()` env convention; lets the operator pick a domain they control so synthesized emails never collide with real ones. |

---

## UX Design

### Before
```
┌───────────────────────────────────────────────────────────────┐
│ Parents have NO account. They see a schedule only via an        │
│ unauthenticated read-only link  /s/<token>  (footer: “本页仅供   │
│ 查看”). To change a time they message the tutor on WeChat, who   │
│ edits the calendar by hand. Every user who signs up becomes the │
│ OWNER of their own brand-new org — there is no parent/student   │
│ login, no per-child view, no request trail.                     │
└───────────────────────────────────────────────────────────────┘
```

### After
```
┌───────────────────────────────────────────────────────────────────────┐
│ Tutor (dashboard) → 学生 → “开通家长/学生登录” →                          │
│    provisionPortalAccount(studentId, {name, loginId?, password, kind})   │
│    → createUser + addMember('parent'|'student') + portalLink row         │
│                                                                          │
│ Parent → /login (same page) → dispatched to /portal                      │
│    /portal            : 我的课表 — only THIS child's upcoming lessons     │
│                         (ScheduleCard, cardWindow, forTenant spine)      │
│    first visit        : 数据处理告知 consent gate → stamps consentedAt    │
│    /portal/reschedule : 我的改期申请 — list own requests + “申请改期”:     │
│                         pick lesson → new 开始/结束 + 原因 → create        │
│                         (status=pending)  |  cancel own pending          │
│                                                                          │
│ Tutor → /dashboard/reschedule : 待处理改期申请                            │
│    approve → rescheduleLessonCore moves the lesson (same conflict check   │
│              + GiST backstop) → request=approved, reviewedBy/At stamped   │
│              (on CONFLICT: stays pending, shows conflicts + 建议时段)      │
│    reject  → request=rejected                                            │
└───────────────────────────────────────────────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Parent account | none (link only) | provisioned `parent`/`student` login | no self-signup; placeholder email if WeChat-only |
| Parent views schedule | `/s/<token>` (public) | `/portal` (authenticated, per-child) | reuses `ScheduleCard` + `getStudentLessonsForTenant` |
| Request a time change | WeChat message | `/portal/reschedule` create form → `pending` | reason captured; audit trail |
| Tutor changes the time | manual calendar edit | `/dashboard/reschedule` approve → `rescheduleLessonCore` | identical conflict check + suggestions |
| Cancel a request | n/a | parent cancels own `pending` | `['cancel']` + ownership |
| Consent | share-page footer link | first-login consent gate + extended `/privacy` | stamps `consentedAt` |
| Sign out | none anywhere | portal + dashboard button | `authClient.signOut` (new) |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/auth/auth.ts` | 1-70 | The `user.create.after` auto-tenant hook (**branch in Task 3**) + `session.create.before` + plugin config (`organization`/`admin`). |
| P0 | `src/auth/context.ts` | 8-51 | `AuthContext` + `AuthError` codes + `getAuthContext`/`requireAuthContext` (role re-derived from `member` every request). |
| P0 | `src/auth/authorize.ts` | 5-17 | `can()` / `requirePermission(ctx, {...})` — the RBAC gate every new action calls. |
| P0 | `src/auth/permissions.ts` | 13-75 | The full org role matrix; **`rescheduleRequest` verbs are already declared** — do NOT change. |
| P0 | `src/db/tenant.ts` | 1-55 | `forTenant(ctx)` — the ONLY sanctioned tenant path (no RLS). Single-table; multi-hop needs a hand-written scoped query. |
| P0 | `src/lib/schedule-core.ts` | 99-135 | `rescheduleLessonCore(ctx, {id,startAt,endAt})` — the exact fn the approve path calls; returns `ScheduleResult`. |
| P0 | `src/db/schema/reserved.ts` | 15-40 | `rescheduleRequest` table (already migrated) — **add `studentId` in Task 1**. |
| P0 | `src/db/schema/_helpers.ts` | 1-21 | `primaryId()/tenantId()/createdAt()/updatedAt()` — use verbatim for `portalLink`. |
| P0 | `src/db/schema/enrollment.ts` | 8-42 | The canonical tenant table (composite FK + covering indexes + partial-unique) — the shape `portalLink` mirrors. |
| P1 | `src/app/dashboard/students/actions.ts` | 12-32 | `WRITE_ACTION_4STEP_TEMPLATE` — the canonical action shape all new actions follow. |
| P1 | `src/app/dashboard/reports/actions.ts` | 16-67 | Thin-wrapper-over-core + custom `approve` verb — the model for `reschedule-core` + its actions. |
| P1 | `src/app/dashboard/students/share-data.ts` | 36-58 | `getStudentLessonsForTenant(ctx, studentId, window)` — reused verbatim for the portal schedule view. |
| P1 | `src/lib/ical-feed.ts` | 11-40 | `FeedLesson` + `cardWindow()`/`feedWindow()` window helpers. |
| P1 | `src/lib/errors.ts` | 1-19 | `ConflictError` + `isExclusionViolation` — the approve path must handle a thrown `ConflictError`. |
| P1 | `src/app/(auth)/login/page.tsx` | 1-68 | Login flow + `authClient.signIn.email` + form markup to mirror; the `/dashboard` redirect to change. |
| P1 | `src/app/dashboard/layout.tsx` | 1-37 | Dashboard shell + `getAuthContext` guard (no role gating today) — the portal layout mirrors + adds role gating. |
| P1 | `src/app/dashboard/students/student-form.tsx` | 1-35 | `useTransition` server-action form idiom for the provisioning + reschedule forms. |
| P1 | `src/app/s/[token]/page.tsx` | 16-44 | The current read-only parent view + `ScheduleCard` usage + `/privacy` footer link to align with. |
| P1 | `src/app/privacy/page.tsx` | 1-69 | Existing PIPL notice (inline-styled) — **extend** for minors/consent/write-path. |
| P1 | `src/db/schema/relations.ts` | 16-30 | Relations graph — **add** `rescheduleRequestRelations` + `portalLinkRelations` (code-only). |
| P1 | `src/db/queries/organizations.ts` | 8-15 | `getDefaultOrganizationId` — the only org helper; add portal-provisioning helpers here or a new `portal.ts`. |
| P2 | `tests/report-db.test.ts` | 38-119, 143-160 | The fullest DB fixture (`cleanup`→org→user→member→domain) + approve-lifecycle assertion to mirror. |
| P2 | `tests/rbac-scheduling.test.ts` | 1-24 | Pure `can()` matrix style for the new `rescheduleRequest` RBAC test. |
| P2 | `tests/tenant-isolation.test.ts` | 9-14, 54-68 | `ctxFor` stub + IDOR assertion style for cross-tenant **and** other-child tests. |
| P2 | `drizzle/0001_lesson_teacher_exclusion.sql` | 1-18 | Raw-SQL migration house style (if migration 0006 needs any hand-written SQL). |
| P2 | `.claude/PRPs/plans/completed/phase-6-claude-mcp-connector.plan.md` | all | Plan house-style this doc follows. |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Admin `createUser` (server) | `better-auth.com/docs/plugins/admin` | `await auth.api.createUser({ body: { email, password, name, role?, data? } })` — mints a credential account, hashes the password, **runs DB hooks**. Creates a USER only (no org). `createUser` is the one admin endpoint callable **without** a session; pass `headers: await headers()` if your install enforces it. |
| Org `addMember` (server-only) | `better-auth.com/docs/plugins/organization` | `await auth.api.addMember({ body: { userId, role, organizationId } })` — adds an **existing** user as a member with a role, **no email/invite**. `role` accepts `string \| string[]`. No `authClient.organization.addMember` exists — server-only, trusted; guard it behind your own RBAC. |
| Two role stores | admin + organization docs | **admin-plugin `user.role`** (global, `setRole` by `userId`) vs **org `member.role`** (per-tenant, `updateMemberRole` by **`memberId`**). Multi-role = comma-joined string. `activeOrganizationId` is **not** auto-set at login — the `session.create.before` hook (already present) resolves it to the user's single membership. |
| No-email accounts | admin + username docs | `user.email` is `NOT NULL UNIQUE`; the `username` plugin **adds** username sign-in but does **not** drop the email requirement. Chosen path: synthesize a unique placeholder email; `auth.api.setUserPassword({ body: { newPassword, userId }, headers })` can (re)attach credentials later. |
| Client sign-in | `better-auth.com/docs` | `authClient.signIn.email({ email, password })` (already used at `login/page.tsx`); `authClient.signOut()` for the new sign-out button. |

```
KEY_INSIGHT: `user.create.after` fires for EVERY user creation — including `auth.api.createUser`. Un-branched, a provisioned parent becomes OWNER of a brand-new org, NOT a member of the tutor's org, and `session.create.before` (no ORDER BY) may pick that junk org.
APPLIES_TO: Task 3 (branch the hook), Task 4 (provisioning)
GOTCHA: Branch on the endpoint (`context.path === '/sign-up/email'`). Verify the `after(user, context)` second-arg shape in node_modules/better-auth@1.7.4 in Task 0; fallback = a `user.additionalFields` `isPortalUser` boolean + branch on it.

KEY_INSIGHT: RBAC authorizes the ACTION for the role but never scopes to a child row. `forTenant(ctx)` isolates tenants, not users within a tenant. Parent-only-their-child MUST be enforced by a row filter derived from the trusted `portalLink` + `enrollment` — there is ZERO existing precedent, so it must be added AND tested (other-child IDOR).
APPLIES_TO: Task 6 (portal data), Task 7 (reschedule-core create), Task 14 (tests)
GOTCHA: Never take studentId from the request unchecked; resolve permitted studentIds server-side from portalLink where userId = ctx.userId.

KEY_INSIGHT: Approving a reschedule reuses `rescheduleLessonCore`, which returns a `{ok:false, error:'CONFLICT', suggestions}` union on a soft double-booking AND throws `ConflictError` on a GiST race. The approve action must handle BOTH — a successful call does not guarantee the lesson moved.
APPLIES_TO: Task 7 (approveRescheduleRequestCore)
GOTCHA: On {ok:false} keep the request `pending` and surface conflicts+suggestions to the teacher; only flip to `approved` on {ok:true}. Wrap for a thrown ConflictError.
```

---

## Patterns to Mirror

All snippets are **verbatim** from the current codebase (worktree `main`) or the verified Better-Auth 1.7.4 docs.

### AUTO_TENANT_HOOK_TO_BRANCH (Task 3 — skip for admin-provisioned portal users)
```ts
// SOURCE: src/auth/auth.ts:18-43
databaseHooks: {
  user: {
    create: {
      // M4: give every new user their own tenant on signup. ...
      after: async (user) => {
        const orgId = nanoid()
        await db.transaction(async (tx) => {
          await tx.insert(organizationTable).values({ id: orgId, name: `${user.name} 的机构`, slug: `org-${orgId}`, createdAt: new Date() })
          await tx.insert(member).values({ id: nanoid(), organizationId: orgId, userId: user.id, role: 'owner', createdAt: new Date() })
        })
      },
    },
  },
  session: { create: { before: async (session) => { /* activeOrganizationId = first member org */ } } },
},
```

### WRITE_ACTION_4STEP_TEMPLATE (every new Server Action follows this exact order)
```ts
// SOURCE: src/app/dashboard/students/actions.ts:12-32
const createStudentSchema = z.object({
  name: z.string().trim().min(1, '姓名不能为空').max(100),
  parentWechat: z.string().trim().max(100).optional(),
})
export type CreateStudentInput = z.input<typeof createStudentSchema>
export async function createStudent(input: CreateStudentInput) {
  const ctx = await requireAuthContext()             // 1) verified principal + tenant (ignore any client orgId)
  requirePermission(ctx, { student: ['create'] })    // 2) RBAC guard at the top
  const data = createStudentSchema.parse(input)      // 3) validate + trim before persisting
  const [row] = await forTenant(ctx).insert(student, { name: data.name, parentWechat: data.parentWechat }) // 4) tenant-scoped write
  revalidatePath('/dashboard/students')
  return row
}
```

### THIN_WRAPPER_OVER_CORE + CUSTOM_APPROVE_VERB (model for reschedule-core + its actions)
```ts
// SOURCE: src/app/dashboard/reports/actions.ts:16-67 (abridged)
// Thin web wrappers over report-core. Every action: requireAuthContext → requirePermission → zod parse → core → revalidatePath.
export async function createReportDraft(input: CreateReportInput): Promise<Report> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { report: ['create'] })
  const data = createSchema.parse(input)
  const row = await createReportDraftCore(ctx, { studentId: data.studentId, /* ... */ })
  revalidatePath('/dashboard/reports')
  return row
}
// approve is its own verb: requirePermission(ctx, { report: ['approve'] }) → approveReportCore(ctx, id)
```

### RESCHEDULE_LESSON_CORE (Task 7 approve path calls this verbatim — do NOT reimplement)
```ts
// SOURCE: src/lib/schedule-core.ts:99-135
export async function rescheduleLessonCore(ctx: AuthContext, input: z.input<typeof rescheduleSchema>): Promise<ScheduleResult> {
  const data = rescheduleSchema.parse(input) // { id, startAt, endAt } refined endAt>startAt
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

### AUTHENTICATED_PER_STUDENT_READ (reused verbatim for the portal schedule view)
```ts
// SOURCE: src/app/dashboard/students/share-data.ts:36-58
// Authenticated per-student slice ... M1 forbids raw db on the authenticated path. Same pure slicer as the public path.
export async function getStudentLessonsForTenant(ctx: AuthContext, studentId: string, window: { from: Date; to: Date }): Promise<FeedLesson[]> {
  const secs = (await forTenant(ctx).select(enrollment, and(eq(enrollment.studentId, studentId), eq(enrollment.status, 'active')))) as (typeof enrollment.$inferSelect)[]
  const ids = secs.map((s) => s.sectionId)
  if (ids.length === 0) return []                       // inArray([]) is invalid SQL — always guard
  const rows = (await forTenant(ctx).select(lesson, inArray(lesson.sectionId, ids))) as (typeof lesson.$inferSelect)[]
  return sliceLessonsForSections(rows, ids, window)
}
```

### TENANT_TABLE_SHAPE (mirror for `portalLink`; composite FK + covering indexes + partial/compound unique)
```ts
// SOURCE: src/db/schema/enrollment.ts:8-42 (structure) & src/db/schema/share-link.ts:8-35 (per-student capability + FK-target index)
export const enrollment = pgTable('enrollment', {
  id: primaryId(), tenantId: tenantId(),
  studentId: text('student_id').notNull(),
  sectionId: text('section_id').notNull(),
  status: enrollmentStatus('status').notNull().default('active'),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('uq_enrollment_student_section').on(t.tenantId, t.studentId, t.sectionId).where(sql`${t.status} = 'active'`),
  foreignKey({ columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id], name: 'fk_enrollment_student' }).onDelete('cascade'),
  index('idx_enrollment_tenant_student').on(t.tenantId, t.studentId),
])
```

### RESERVED_RESCHEDULE_REQUEST (Task 1 adds `studentId` + its FK + index)
```ts
// SOURCE: src/db/schema/reserved.ts:15-40
export const rescheduleRequest = pgTable('reschedule_request', {
  id: primaryId(), tenantId: tenantId(),
  lessonId: text('lesson_id').notNull(),
  requestedById: text('requested_by_id'),          // parent/student user.id
  requestedStartAt: timestamp('requested_start_at', { withTimezone: true, mode: 'date' }),
  requestedEndAt: timestamp('requested_end_at', { withTimezone: true, mode: 'date' }),
  reason: text('reason'),
  status: rescheduleStatus('status').notNull().default('pending'), // ['pending','approved','rejected','canceled']
  reviewedById: text('reviewed_by_id'),            // teacher user.id
  reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.lessonId], foreignColumns: [lesson.tenantId, lesson.id], name: 'fk_reschedule_lesson' }).onDelete('cascade'),
  index('idx_reschedule_tenant_status').on(t.tenantId, t.status),
  index('idx_reschedule_tenant_lesson').on(t.tenantId, t.lessonId),
])
```

### CLIENT_AUTH_FORM (login/signout/provision/reschedule forms mirror this)
```ts
// SOURCE: src/app/(auth)/login/page.tsx:15-27 + student-form.tsx:16-33
const { error } = await authClient.signIn.email({ email, password })   // {error?.message}
if (error) { setError(error.message ?? '登录失败'); return }
router.push('/dashboard'); router.refresh()                            // CHANGE to router.push('/')
// server-action form: const [pending, startTransition] = useTransition(); startTransition(async () => { try { await action(...) ; router.refresh() } catch (e) { setError(e instanceof Error ? e.message : '保存失败') } })
```

### DASHBOARD_SHELL_GUARD (portal layout mirrors + adds a role gate)
```ts
// SOURCE: src/app/dashboard/layout.tsx:8-11
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  // portal layout ADDS: if (!isPortalRole(ctx.role)) redirect('/dashboard')
```

### ERROR_TAXONOMY (Chinese throw messages + typed PG-code helpers)
```ts
// SOURCE: src/lib/errors.ts:3-19 & src/auth/context.ts:8-13
export class ConflictError extends Error { constructor(public detail = '时间冲突') { super('CONFLICT'); this.name = 'ConflictError' } }
export function isExclusionViolation(e: unknown): boolean { /* walks .cause chain 5 deep for code === '23P01' */ }
// AuthError codes: 'UNAUTHENTICATED' | 'NO_ACTIVE_ORG' | 'NOT_A_MEMBER' | 'FORBIDDEN'. Business rules throw new Error('<中文>').
```

### DB_FIXTURE_LIFECYCLE (mirror for the Task 14 DB test)
```ts
// SOURCE: tests/report-db.test.ts:57-119 (abridged) & tests/tenant-isolation.test.ts:9-14
const ctxFor = (tenantId: string, userId: string, role = 'owner'): AuthContext => ({ tenantId, userId, role, isPlatformAdmin: false })
const cleanup = async () => { /* delete CHILDREN before PARENTS, keyed by eq(table.tenantId, org): rescheduleRequest, portalLink, grade, attendance, lesson, enrollment, classSection, course, student; THEN member, organization, user */ }
beforeAll(async () => {
  await cleanup(); const now = new Date()
  await db.insert(organization).values([{ id: org, name: 'R', slug: 'r-7a', createdAt: now }])        // org REQUIRES createdAt
  await db.insert(user).values([{ id: parentUserId, name: 'P', email: 'p@t.com', emailVerified: true }]) // user needs emailVerified
  await db.insert(member).values([{ id: 'm_parent', organizationId: org, userId: parentUserId, role: 'parent', createdAt: now }])
  const ctx = ctxFor(org, ownerUserId)
  const [st] = (await forTenant(ctx).insert(student, { name: '测试学生' })) as { id: string }[]
  // ... section/enrollment/lesson via forTenant(ctx).insert; portalLink + rescheduleRequest via forTenant too
})
afterAll(cleanup)
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/db/schema/enums.ts` | UPDATE | Add `portalRelationship = pgEnum('portal_relationship', ['parent','student'])`. |
| `src/db/schema/portal-link.ts` | CREATE | New `portalLink` table linking `user` ↔ `student` (P7a-3). |
| `src/db/schema/reserved.ts` | UPDATE | Add `studentId` + composite FK + `idx_reschedule_tenant_student` to `rescheduleRequest` (P7a-4). |
| `src/db/schema/index.ts` | UPDATE | `export * from './portal-link'` (reserved already exported). |
| `src/db/schema/relations.ts` | UPDATE | Add `portalLinkRelations` + `rescheduleRequestRelations` (+ `lesson.rescheduleRequests`) for relational reads. |
| `drizzle/0006_*.sql` (+ `meta/`) | CREATE | `drizzle-kit generate` → `portal_link` table + `portal_relationship` enum + `reschedule_request.student_id` col/FK/index. |
| `src/env.ts` | UPDATE | Add `PORTAL_EMAIL_DOMAIN` (P7a-10). |
| `src/auth/auth.ts` | UPDATE | Branch `user.create.after` to skip admin-provisioned portal users (P7a-2). |
| `src/auth/portal.ts` | CREATE | `isPortalRole(role)`, `resolveLinkedStudentIds(ctx)`, `assertLinkedToStudent(ctx, studentId)` — portal role + row-scope helpers. |
| `src/db/queries/organizations.ts` | UPDATE | Add `provisionPortalMember(...)` low-level helper wrapping `createUser` + `addMember` (or a new `src/db/queries/portal.ts`). |
| `src/lib/reschedule-core.ts` | CREATE | `create/approve/reject/cancelRescheduleRequestCore` (P7a-6). |
| `src/app/dashboard/students/portal-actions.ts` | CREATE | `provisionPortalAccount` Server Action (owner/admin) (P7a-1). |
| `src/app/dashboard/students/portal-account-form.tsx` | CREATE | Provisioning form on the students page. |
| `src/app/dashboard/students/page.tsx` | UPDATE | Surface per-student "开通登录" affordance. |
| `src/app/dashboard/reschedule/page.tsx` | CREATE | Teacher review list (pending requests). |
| `src/app/dashboard/reschedule/actions.ts` | CREATE | `approveRescheduleRequest`/`rejectRescheduleRequest` thin actions. |
| `src/app/dashboard/reschedule/data.ts` | CREATE | `listRescheduleRequests(ctx, status?)` loader (joins lesson + student). |
| `src/app/dashboard/reschedule/review-panel.tsx` | CREATE | Approve/reject UI (drawer/segmented-button idiom). |
| `src/app/dashboard/layout.tsx` | UPDATE | Add "改期申请" nav link + sign-out button. |
| `src/app/page.tsx` | UPDATE | Role dispatcher (parent/student → `/portal`, else `/dashboard`). |
| `src/app/(auth)/login/page.tsx` | UPDATE | Post-login redirect `/dashboard` → `/`. |
| `src/app/portal/layout.tsx` | CREATE | Role-gated portal shell + nav + sign-out + consent gate. |
| `src/app/portal/page.tsx` | CREATE | "我的课表" — linked student(s) schedule via `ScheduleCard`. |
| `src/app/portal/data.ts` | CREATE | `getPortalSchedule(ctx)` — resolve linked students → lessons. |
| `src/app/portal/reschedule/page.tsx` | CREATE | List own requests + upcoming lessons to request against. |
| `src/app/portal/reschedule/actions.ts` | CREATE | `createRescheduleRequest`/`cancelRescheduleRequest` (parent/student). |
| `src/app/portal/reschedule/request-form.tsx` | CREATE | Pick lesson + new time + reason form. |
| `src/app/portal/consent-actions.ts` | CREATE | `acknowledgeConsent()` → stamps `portalLink.consentedAt`. |
| `src/app/privacy/page.tsx` | UPDATE | Add minors/guardian-consent, retention, legal-basis, authenticated-write-path sections. |
| `tests/rbac-reschedule.test.ts` | CREATE | Pure `can()` matrix for `rescheduleRequest` verbs across roles. |
| `tests/reschedule-core.test.ts` | CREATE | DB-integration: create→approve (lesson moved) / reject / cancel / conflict / other-child + cross-tenant IDOR. |
| `tests/portal-scope.test.ts` | CREATE | `resolveLinkedStudentIds` + `assertLinkedToStudent` row-scope (parent A cannot see child B). |
| `.claude/PRPs/prds/course-scheduling-system.prd.md` | UPDATE | Split Phase 7 → 7a (in-progress, link plan) + 7b–7e (pending). |
| `.env.example` | UPDATE (if present) | Document `PORTAL_EMAIL_DOMAIN`. |
| `src/auth/authorize.ts`, `src/auth/permissions.ts`, `src/db/tenant.ts`, `src/lib/schedule-core.ts`, `src/lib/errors.ts`, `src/app/dashboard/students/share-data.ts`, `src/lib/share.ts` | (NO CHANGE) | Reused verbatim — verify only. |

## NOT Building
- **Reminders / notifications** (email/SMS/WeChat, cron) — **Phase 7b**. Approved reschedules are NOT auto-notified here; the parent sees the update on next portal visit / re-export.
- **MCP OAuth 2.1 (WorkOS AuthKit)** — **Phase 7c**. MCP stays static-bearer.
- **Google two-way sync / invite attendees (user OAuth)** — **Phase 7d** (optional).
- **iCloud CalDAV write-back** — remains "Won't (now)".
- **Payments / credit packages** — **Phase 7e** (tables already reserved; untouched here).
- **Assistant/admin invite UI, org-switching, multi-org membership** — parents/students are single-org; staff continue via self-signup (owner) as today.
- **Editing the lesson directly from the portal** — parents/students NEVER get `lesson:['update']`; they only create a `rescheduleRequest`; the tutor's approval performs the move.
- **Recurring-series reschedule** — a request targets a single `lesson` instance (sets `isException=true` on approve), never a whole RRULE series.
- **Username/phone Better-Auth plugin, Anonymous plugin, relaxing `user.email`** — no-email parents get a synthesized placeholder email (P7a-1); no new auth provider.
- **jsdom / React-Testing-Library component tests** — not wired in this repo; portal logic is tested via server-side cores (node env), per the existing convention.
- **Reusing the `/s/[token]` public path in the portal** — the portal is authenticated → `forTenant` spine only (M1).

---

## Step-by-Step Tasks

> **PR-1 (server-side, headless-testable): Tasks 0–8.  PR-2 (UI): Tasks 9–15.**

### Task 0: Verify Better-Auth 1.7.4 provisioning surface + hook context
- **ACTION**: Confirm the exact APIs before writing provisioning/hook code.
- **IMPLEMENT**: In `node_modules/better-auth`, verify: (1) `auth.api.createUser` signature + whether it requires a session server-side (grep the admin plugin); (2) `auth.api.addMember` body shape + whether it enforces caller RBAC when no headers are passed; (3) the `databaseHooks.user.create.after` **second argument** — does it expose `context.path` (or `.request`) so we can detect `/sign-up/email` vs `/admin/create-user`? (4) `authClient.signOut` shape.
- **MIRROR**: External Documentation table.
- **IMPORTS**: n/a (inspection).
- **GOTCHA**: If `createUser` requires a session server-side, pass `headers: await headers()` from the provisioning action (the acting owner's session). If the `after(user, context)` context path is NOT reliably available in 1.7.4, use the **fallback** (P7a-2): declare `user: { additionalFields: { isPortalUser: { type: 'boolean', required: false, input: false } } }` in `betterAuth({...})`, pass `data: { isPortalUser: true }` to `createUser`, and branch the hook on `user.isPortalUser`. Record the confirmed approach in a code comment.
- **VALIDATE**: Write down the confirmed call shapes; no code yet.

### Task 1: Schema — `portalLink` table + `rescheduleRequest.studentId` + enum
- **ACTION**: Add the link table, the request `studentId`, and the relationship enum.
- **IMPLEMENT**:
  - `src/db/schema/enums.ts`: add `export const portalRelationship = pgEnum('portal_relationship', ['parent', 'student'])`.
  - `src/db/schema/portal-link.ts` (mirror `enrollment`/`share-link`):
    ```ts
    import { pgTable, text, timestamp, index, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core'
    import { primaryId, tenantId, createdAt, updatedAt } from './_helpers'
    import { portalRelationship } from './enums'
    import { student } from './student'
    export const portalLink = pgTable('portal_link', {
      id: primaryId(),
      tenantId: tenantId(),
      studentId: text('student_id').notNull(),
      userId: text('user_id').notNull(),               // Better Auth user.id — bare text, NO FK (auth-owned)
      relationship: portalRelationship('relationship').notNull(),
      consentedAt: timestamp('consented_at', { withTimezone: true, mode: 'date' }), // PIPL consent stamp (P7a-9)
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    }, (t) => [
      uniqueIndex('uq_portal_link_student_user').on(t.tenantId, t.studentId, t.userId),
      foreignKey({ columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id], name: 'fk_portal_link_student' }).onDelete('cascade'),
      index('idx_portal_link_tenant_user').on(t.tenantId, t.userId),
      index('idx_portal_link_tenant_student').on(t.tenantId, t.studentId),
    ])
    ```
  - `src/db/schema/reserved.ts`: add `studentId: text('student_id')` (nullable — old rows have none) to `rescheduleRequest` and, in the table extras, `foreignKey({ columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id], name: 'fk_reschedule_student' }).onDelete('cascade')` + `index('idx_reschedule_tenant_student').on(t.tenantId, t.studentId)`. (`student` is already imported in `reserved.ts`.)
  - `src/db/schema/index.ts`: `export * from './portal-link'`.
- **MIRROR**: `TENANT_TABLE_SHAPE`, `RESERVED_RESCHEDULE_REQUEST`, `PRIMARY_ID_AND_TENANT_HELPERS`.
- **IMPORTS**: as shown; `student` FK-target index `uq_student_tenant_id` already exists.
- **GOTCHA**: (1) `userId` is **bare text, NO `.references()`** — auth tables are Better-Auth-owned (matches `class_section.teacherId`). (2) `rescheduleRequest.studentId` is **nullable** to avoid breaking the migration on any pre-existing rows, but every NEW portal request sets it. (3) enum name is snake_case `portal_relationship`; Drizzle maps camelCase keys automatically (`casing:'snake_case'`).
- **VALIDATE**: `pnpm typecheck`.

### Task 2: Generate + apply migration 0006
- **ACTION**: Generate the Drizzle migration for Task 1 and apply it.
- **IMPLEMENT**: `pnpm db:generate` → creates `drizzle/0006_*.sql` (new `portal_relationship` type, `portal_link` table + indexes/FK, `reschedule_request.student_id` column + FK + index) and updates `drizzle/meta/`. Review the SQL. Apply with `pnpm db:migrate` against the local docker Postgres.
- **MIRROR**: migration house style; `drizzle/0001_lesson_teacher_exclusion.sql` if any manual SQL is needed (it should not be).
- **IMPORTS**: n/a.
- **GOTCHA**: `rescheduleStatus`/`paymentStatus` enums already exist in the DB (created in `0000`) — the generator must NOT re-`CREATE TYPE` them. Confirm the generated SQL only adds `portal_relationship`, `portal_link`, and the `reschedule_request.student_id` alteration. Migrations are guarded by an advisory lock in `scripts/migrate.ts`.
- **VALIDATE**: `pnpm db:migrate` clean; `pnpm db:studio` (or `\d portal_link`) shows the table + FK; re-running migrate is a no-op.

### Task 3: Branch the auto-tenant hook (`src/auth/auth.ts`)
- **ACTION**: Stop admin-provisioned portal users from getting their own org.
- **IMPLEMENT**: Per Task-0's finding, either change `after: async (user) => {...}` to `after: async (user, context) => { if (context?.path && context.path !== '/sign-up/email') return; ...existing... }`, **or** the `additionalFields` fallback branching on `user.isPortalUser`. Add a comment explaining portal users join the tutor's org via `addMember` (Task 4) and must not self-tenant.
- **MIRROR**: `AUTO_TENANT_HOOK_TO_BRANCH`.
- **IMPORTS**: existing.
- **GOTCHA**: Keep the self-signup path (owner registration) working **unchanged** — verify a normal signup still creates its org+owner. The `session.create.before` hook is left as-is: a portal user with exactly one membership (the tutor's) resolves correctly.
- **VALIDATE**: `pnpm typecheck`; manual: self-signup still lands on `/dashboard`; a `createUser`-provisioned user has **no** auto org (verified via the Task 4 action + a DB check).

### Task 4: Provisioning — helper + Server Action
- **ACTION**: Owner/admin provisions a `parent`/`student` login for a student.
- **IMPLEMENT**:
  - Low-level helper (in `src/db/queries/organizations.ts` or new `src/db/queries/portal.ts`): `provisionPortalMember({ name, email, password, orgId, orgRole })` → `auth.api.createUser({ body: { email, password, name /*, data:{isPortalUser:true} if fallback*/ }, /* headers if Task 0 requires */ })` then `auth.api.addMember({ body: { userId: created.user.id, role: orgRole, organizationId: orgId } })`; returns `{ userId }`.
  - `src/app/dashboard/students/portal-actions.ts` (`'use server'`): `provisionPortalAccount(input)` where `input = { studentId, name, kind: 'parent'|'student', loginId?: string, password: string }`:
    1. `const ctx = await requireAuthContext()`
    2. `requirePermission(ctx, { student: ['update'], member: ['create'] })` (owner/admin/teacher can manage students + members).
    3. zod parse (`password min 8`; `name` trim/min1; `loginId` optional trim).
    4. `const s = await forTenant(ctx).findById(student, data.studentId)`; `if (!s) throw new Error('学生不存在')`.
    5. `const email = data.loginId?.includes('@') ? data.loginId : \`portal_${nanoid()}@${env.PORTAL_EMAIL_DOMAIN}\``.
    6. `const { userId } = await provisionPortalMember({ name: data.name, email, password: data.password, orgId: ctx.tenantId, orgRole: data.kind })`.
    7. `await forTenant(ctx).insert(portalLink, { studentId: data.studentId, userId, relationship: data.kind })`.
    8. `revalidatePath('/dashboard/students')`; return `{ userId, email }` (show the login email to the tutor so they can pass it on).
- **MIRROR**: `WRITE_ACTION_4STEP_TEMPLATE`; External Documentation (`createUser`/`addMember`).
- **IMPORTS**: `auth` from `@/auth/auth`; `nanoid`; `env`; `forTenant`; `portalLink`, `student` from `@/db/schema`; `requireAuthContext`/`requirePermission`.
- **GOTCHA**: (1) `addMember` is **server-only + trusted** — the `requirePermission` above is the guard; never expose it to the client. (2) `role` for `addMember` must be the literal `'parent'`/`'student'` (an `orgRoles` key). (3) If `loginId` is a plain handle (not an email), it becomes part of the display but the **account email** is still synthesized — document that WeChat parents sign in with the shown `portal_*@...` email + password (a username-plugin login is a future nicety, out of scope). (4) Handle a duplicate-email/`createUser` error and surface a Chinese message.
- **VALIDATE**: covered by Task 14 (DB integration: provision → member row role='parent' → portalLink row → the user has exactly ONE membership).

### Task 5: Portal auth helpers (`src/auth/portal.ts`)
- **ACTION**: Role predicate + row-scope resolvers.
- **IMPLEMENT**:
  ```ts
  import 'server-only'
  import { and, eq } from 'drizzle-orm'
  import { forTenant } from '@/db/tenant'
  import { portalLink } from '@/db/schema'
  import type { AuthContext } from '@/auth/context'
  export const PORTAL_ROLES = ['parent', 'student'] as const
  export function isPortalRole(role: string): boolean { return role.split(',').map((r) => r.trim()).some((r) => (PORTAL_ROLES as readonly string[]).includes(r)) }
  export async function resolveLinkedStudentIds(ctx: AuthContext): Promise<string[]> {
    const rows = (await forTenant(ctx).select(portalLink, eq(portalLink.userId, ctx.userId))) as (typeof portalLink.$inferSelect)[]
    return rows.map((r) => r.studentId)
  }
  export async function assertLinkedToStudent(ctx: AuthContext, studentId: string): Promise<void> {
    const rows = (await forTenant(ctx).select(portalLink, and(eq(portalLink.userId, ctx.userId), eq(portalLink.studentId, studentId)))) as unknown[]
    if (rows.length === 0) throw new Error('无权访问该学生')
  }
  ```
- **MIRROR**: `AUTHENTICATED_PER_STUDENT_READ` (forTenant.select + extra predicate).
- **IMPORTS**: as shown.
- **GOTCHA**: This is the **only** place row-level parent→child scoping is derived — always from `ctx.userId` via `portalLink`, never a request param. `forTenant` already scopes by tenant, so the extra predicate is `userId`/`studentId` only.
- **VALIDATE**: covered by `tests/portal-scope.test.ts` (Task 14).

### Task 6: Portal schedule data loader (`src/app/portal/data.ts`)
- **ACTION**: Return only the acting user's linked students' upcoming lessons.
- **IMPLEMENT**:
  ```ts
  import 'server-only'
  import type { AuthContext } from '@/auth/context'
  import { forTenant } from '@/db/tenant'
  import { student } from '@/db/schema'
  import { getStudentLessonsForTenant } from '@/app/dashboard/students/share-data'
  import { cardWindow } from '@/lib/ical-feed'
  import { resolveLinkedStudentIds } from '@/auth/portal'
  import type { FeedLesson } from '@/lib/ical-feed'
  export async function getPortalSchedule(ctx: AuthContext): Promise<{ studentName: string; subtitle?: string; lessons: FeedLesson[] }[]> {
    const ids = await resolveLinkedStudentIds(ctx)
    const out = []
    for (const id of ids) {
      const s = (await forTenant(ctx).findById(student, id)) as typeof student.$inferSelect | null
      if (!s) continue
      out.push({ studentName: s.name, subtitle: s.schoolGrade ?? undefined, lessons: await getStudentLessonsForTenant(ctx, id, cardWindow()) })
    }
    return out
  }
  ```
- **MIRROR**: `AUTHENTICATED_PER_STUDENT_READ`; `READ_LOADER_SHAPE_SERVER_ONLY` (`data.ts` convention — `ctx`-first, no self-gate).
- **IMPORTS**: as shown.
- **GOTCHA**: `data.ts` loaders do NOT self-gate — the calling page (Task 11) owns `requireAuthContext` + role guard. Reuses the exact `getStudentLessonsForTenant` (M1 authenticated path), NOT the public token path.
- **VALIDATE**: `pnpm typecheck`; exercised by Task 14 scope test.

### Task 7: `src/lib/reschedule-core.ts` — request state machine
- **ACTION**: Create/approve/reject/cancel cores (headless; no `requireAuthContext`/`revalidatePath`).
- **IMPLEMENT** (mirror `report-core` shape):
  - `createRescheduleRequestCore(ctx, { studentId, lessonId, requestedStartAt, requestedEndAt, reason? })`: `assertLinkedToStudent(ctx, studentId)`; load lesson via `forTenant(ctx).findById(lesson, lessonId)` (throw `'课节不存在'` if null); verify the student has an **active enrollment** in `lesson.sectionId` (`forTenant(ctx).select(enrollment, and(eq(studentId), eq(sectionId), eq(status,'active')))` → non-empty, else throw `'该学生未在此班级'`); validate `requestedEndAt > requestedStartAt` (zod refine); `forTenant(ctx).insert(rescheduleRequest, { studentId, lessonId, requestedById: ctx.userId, requestedStartAt, requestedEndAt, reason, status: 'pending' })`; return the row.
  - `approveRescheduleRequestCore(ctx, requestId)`: `forTenant(ctx).findById(rescheduleRequest, requestId)` (throw `'申请不存在'`); `if (req.status !== 'pending') throw new Error('申请已处理')`; call `const result = await rescheduleLessonCore(ctx, { id: req.lessonId, startAt: req.requestedStartAt, endAt: req.requestedEndAt })`; if `!result.ok` **return** `{ ok: false, conflict: result }` (leave request `pending`); on success `forTenant(ctx).update(rescheduleRequest, requestId, { status: 'approved', reviewedById: ctx.userId, reviewedAt: new Date() })`; return `{ ok: true, event: result.event }`.
  - `rejectRescheduleRequestCore(ctx, requestId)`: pending-guard then `update(... { status: 'rejected', reviewedById: ctx.userId, reviewedAt: new Date() })`.
  - `cancelRescheduleRequestCore(ctx, requestId)`: `findById`; **ownership**: `if (req.requestedById !== ctx.userId) throw new Error('无权取消该申请')`; pending-guard; `update(... { status: 'canceled' })`.
- **MIRROR**: `RESCHEDULE_LESSON_CORE`, `THIN_WRAPPER_OVER_CORE`, report-core approve-lock lifecycle, `ERROR_TAXONOMY`.
- **IMPORTS**: `forTenant`; `rescheduleRequest`, `lesson`, `enrollment` from `@/db/schema`; `rescheduleLessonCore` from `@/lib/schedule-core`; `assertLinkedToStudent` from `@/auth/portal`; `z`.
- **GOTCHA**: (1) Approve must handle the `ScheduleResult` **soft-CONFLICT** (`{ok:false}`) AND a thrown `ConflictError` (GiST race) — both leave the request `pending`; only `{ok:true}` approves. (2) `requestedStartAt`/`requestedEndAt` are `date` columns (nullable in schema) — the create schema makes them required; parse with `z.coerce.date()`. (3) Cores take `ctx` and DO NOT call `requireAuthContext`/`revalidatePath` (those live in the actions) so they stay headless-testable.
- **VALIDATE**: `pnpm typecheck`; `tests/reschedule-core.test.ts` (Task 14).

### Task 8: RBAC + env wiring + pure RBAC test
- **ACTION**: Add env, confirm no `permissions.ts` change, add the pure `can()` matrix test.
- **IMPLEMENT**: `src/env.ts` → `PORTAL_EMAIL_DOMAIN: z.string().min(1).default('portal.local')` in `server:`. Verify `permissions.ts` already grants the needed verbs (it does). `tests/rbac-reschedule.test.ts` mirroring `rbac-scheduling.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { can } from '@/auth/authorize'
  describe('RBAC for reschedule requests', () => {
    it('parent/student can create+cancel but NOT approve/reject/lesson:update', () => {
      for (const r of ['parent', 'student']) {
        expect(can(r, { rescheduleRequest: ['create'] })).toBe(true)
        expect(can(r, { rescheduleRequest: ['cancel'] })).toBe(true)
        expect(can(r, { rescheduleRequest: ['approve'] })).toBe(false)
        expect(can(r, { lesson: ['update'] })).toBe(false)
      }
    })
    it('teacher/admin/owner can approve+reject', () => {
      for (const r of ['teacher', 'admin', 'owner']) {
        expect(can(r, { rescheduleRequest: ['approve'] })).toBe(true)
        expect(can(r, { rescheduleRequest: ['reject'] })).toBe(true)
      }
    })
  })
  ```
- **MIRROR**: `PURE_RBAC_MATRIX_TEST`, `PARENT_STUDENT_CAN_ASSERTIONS`, `T3_ENV`.
- **IMPORTS**: as shown.
- **GOTCHA**: `member.role` must be stored literally `'parent'`/`'student'` (the `orgRoles` key `student` aliases `student_role`) — the default `'member'` is not a valid key. Task 4's `addMember` sets it correctly.
- **VALIDATE**: `npx vitest run tests/rbac-reschedule.test.ts` green; `pnpm typecheck` (env).

### Task 9: Reschedule Server Actions (portal + dashboard)
- **ACTION**: Thin wrappers over the cores.
- **IMPLEMENT**:
  - `src/app/portal/reschedule/actions.ts` (`'use server'`): `createRescheduleRequest(input)` → `requireAuthContext` + `requirePermission(ctx, { rescheduleRequest: ['create'] })` + parse + `createRescheduleRequestCore(ctx, ...)` + `revalidatePath('/portal/reschedule')`. `cancelRescheduleRequest(id)` → `requirePermission(ctx, { rescheduleRequest: ['cancel'] })` + core + revalidate.
  - `src/app/dashboard/reschedule/actions.ts` (`'use server'`): `approveRescheduleRequest(id)` → `requirePermission(ctx, { rescheduleRequest: ['approve'] })` + `approveRescheduleRequestCore` + `revalidatePath('/dashboard/reschedule')` + `revalidatePath('/dashboard/schedule')` (lesson moved); return the core's `{ok, conflict?/event?}` so the UI can show conflicts. `rejectRescheduleRequest(id)` similarly with `['reject']`.
- **MIRROR**: `THIN_WRAPPER_OVER_CORE`, `CORE_EXTRACTION_THIN_WRAPPER_PATTERN`.
- **IMPORTS**: cores; `requireAuthContext`/`requirePermission`; `revalidatePath`.
- **GOTCHA**: Approve revalidates BOTH `/dashboard/reschedule` and `/dashboard/schedule`. The action returns the conflict result (does not throw) so the reviewer sees `conflicts` + `suggestions`.
- **VALIDATE**: `pnpm typecheck`.

### Task 10: Root role dispatcher + login redirect + dashboard nav/sign-out
- **ACTION**: Route each role to its home; add sign-out.
- **IMPLEMENT**:
  - `src/app/page.tsx`:
    ```tsx
    import { redirect } from 'next/navigation'
    import { getAuthContext } from '@/auth/context'
    import { isPortalRole } from '@/auth/portal'
    export default async function RootPage() {
      const ctx = await getAuthContext()
      if (!ctx) redirect('/login')
      redirect(isPortalRole(ctx.role) ? '/portal' : '/dashboard')
    }
    ```
  - `src/app/(auth)/login/page.tsx`: change `router.push('/dashboard')` → `router.push('/')` (the dispatcher routes by role).
  - `src/app/dashboard/layout.tsx`: add a `<Link href="/dashboard/reschedule">改期申请</Link>` nav item and a sign-out button (client sub-component calling `authClient.signOut()` then `router.push('/login')`).
- **MIRROR**: `DASHBOARD_SHELL_GUARD`, `CLIENT_AUTH_FORM`.
- **IMPORTS**: as shown.
- **GOTCHA**: Sign-out must be a small `'use client'` component (the layout is a server component). `authClient.signOut` exact shape per Task 0.
- **VALIDATE**: manual — owner login → `/dashboard`; parent login → `/portal`.

### Task 11: Portal shell + schedule page + consent gate
- **ACTION**: Build the role-gated `/portal` shell and "我的课表".
- **IMPLEMENT**:
  - `src/app/portal/layout.tsx` (server): `const ctx = await getAuthContext(); if (!ctx) redirect('/login'); if (!isPortalRole(ctx.role)) redirect('/dashboard')`. Minimal nav (我的课表 `/portal`, 改期申请 `/portal/reschedule`) + sign-out button + a footer `/privacy` link. **Consent gate**: query the acting user's `portalLink` rows; if any has `consentedAt == null`, render a one-time consent screen (extended `/privacy` summary + "我已阅读并同意" button → `acknowledgeConsent()`), blocking children until acknowledged.
  - `src/app/portal/consent-actions.ts` (`'use server'`): `acknowledgeConsent()` → `requireAuthContext` + `forTenant(ctx).select(portalLink, eq(userId, ctx.userId))` → `update` each with `{ consentedAt: new Date() }` + `revalidatePath('/portal')`.
  - `src/app/portal/page.tsx` (server): `const ctx = await requireAuthContext(); requirePermission(ctx, { lesson: ['read'] })`; `const cards = await getPortalSchedule(ctx)`; render one `ScheduleCard` per linked student (reuse `src/lib/schedule-card.tsx`), empty state `暂无排课`.
- **MIRROR**: `DASHBOARD_SHELL_GUARD`, `SERVER_PAGE_PERMISSION_CHECK`, `PUBLIC_SHARE_PAGE_RENDER_AND_PRIVACY_FOOTER` (ScheduleCard usage).
- **IMPORTS**: `getAuthContext`/`requireAuthContext`/`requirePermission`; `isPortalRole`; `getPortalSchedule`; `ScheduleCard`; `authClient` (sign-out sub-component).
- **GOTCHA**: (1) Both `parent` and `student` roles have `lesson:['read']`. (2) `ScheduleCard` takes `{ studentName, subtitle?, lessons }` (Phase-4). (3) The consent gate is per-user (stamps all their links).
- **VALIDATE**: manual — parent sees only their child; first visit shows consent; after ack it doesn't reappear.

### Task 12: Portal reschedule page + request form
- **ACTION**: List own requests + create/cancel.
- **IMPLEMENT**: `src/app/portal/reschedule/page.tsx` (server): gate; load the user's requests (a loader that joins `rescheduleRequest` + `lesson`, scoped to `requestedById = ctx.userId` via `forTenant(ctx).select(rescheduleRequest, eq(requestedById, ctx.userId))`) + the upcoming lessons (`getPortalSchedule`) to request against. `request-form.tsx` (`'use client'`, `useTransition`): select a lesson, input new 开始/结束 (datetime-local) + 原因, submit `createRescheduleRequest`; list rows with status badges + a 取消 button (cancel own `pending`).
- **MIRROR**: `USETRANSITION_SERVER_ACTION_FORM`, `SERVER_PAGE_PERMISSION_CHECK`, table/list idiom (`divide-y` list).
- **IMPORTS**: portal actions; `getPortalSchedule`; `useTransition`/`useRouter`.
- **GOTCHA**: datetime-local values are local strings → the action's zod `z.coerce.date()` handles them; display times in Asia/Shanghai (luxon) as elsewhere. Status labels: 待处理/已通过/已拒绝/已取消 for pending/approved/rejected/canceled.
- **VALIDATE**: manual — create request appears `待处理`; cancel works; other users' requests never shown.

### Task 13: Dashboard teacher review UI
- **ACTION**: Pending-request list + approve/reject.
- **IMPLEMENT**: `src/app/dashboard/reschedule/data.ts`: `listRescheduleRequests(ctx, status='pending')` → `forTenant(ctx).select(rescheduleRequest, eq(status, ...))` joined with `lesson` (for current time) + `student` (name); map to a serializable shape. `page.tsx` (server): gate `requirePermission(ctx, { rescheduleRequest: ['list'] })`; render the list. `review-panel.tsx` (`'use client'`): per row show student, current lesson time, requested time, reason; 通过/拒绝 buttons calling the Task-9 actions; on approve-conflict, render `conflicts` + `建议时段` (from the returned `ScheduleResult`) and keep the row.
- **MIRROR**: `SERVER_PAGE_PERMISSION_CHECK`, `DRAWER_PANEL_AND_DATA_FETCH`, `USETRANSITION_SERVER_ACTION_FORM`, `SCHEDULE_RESULT_UNION_AND_CALENDAR_EVENT` (conflict shape).
- **IMPORTS**: dashboard reschedule actions/data; luxon for display.
- **GOTCHA**: Approve returns `{ok:false, conflict}` on double-booking — the panel must show the conflict rather than assume success. Reviewer needs `rescheduleRequest:['approve'|'reject']` (teacher/admin/owner have it; assistant does not — hide the buttons for assistant or let the action reject).
- **VALIDATE**: manual — approve moves the lesson on `/dashboard/schedule`; conflicting approve shows conflicts + stays pending.

### Task 14: DB-integration + scope tests
- **ACTION**: Prove the workflow + isolation.
- **IMPLEMENT**:
  - `tests/reschedule-core.test.ts` (mirror `report-db.test.ts`): seed org→user(owner+parent)→member(owner, parent)→course→section(capacity 1, teacherId)→student→enrollment(active)→lesson→portalLink(parent↔student). Cases: (a) `createRescheduleRequestCore` inserts `pending` with `studentId`+`requestedById`; (b) create for an **unlinked** student → throws `无权访问该学生`; (c) create for a student **not enrolled** in the lesson's section → throws `该学生未在此班级`; (d) `approveRescheduleRequestCore` on a free slot → lesson `start_at` moved + request `approved` + `reviewedById`/`reviewedAt` set; (e) approve into a conflicting slot (seed a second lesson for the same teacher) → returns `{ok:false}` and request stays `pending` + lesson unmoved; (f) `rejectRescheduleRequestCore` → `rejected`; (g) `cancelRescheduleRequestCore` by non-owner → throws; second approve → throws `申请已处理`.
  - `tests/portal-scope.test.ts`: two parents + two children in ONE org; assert `resolveLinkedStudentIds(ctxParentA)` returns only A's child; `assertLinkedToStudent(ctxParentA, childB)` throws; plus a cross-tenant variant.
- **MIRROR**: `DB_FIXTURE_LIFECYCLE`, `APPROVE_LOCKS_THROWS_ASSERTION`, `TENANT_ISOLATION_IDOR_ASSERTIONS`, `TIME_HELPER_AND_WINDOW`.
- **IMPORTS**: `db`, `forTenant`, schema tables, `eq`/`inArray`, cores, portal helpers, `ctxFor` stub.
- **GOTCHA**: (1) `organization`/`member` inserts REQUIRE `createdAt: now`; `user` needs `emailVerified: true`. (2) Seed domain rows via `forTenant(ctx).insert` (auto-stamps tenantId; no `originalStartAt` needed). (3) `cleanup` deletes `rescheduleRequest` + `portalLink` FIRST (before lesson/enrollment/student), in both `beforeAll` and `afterAll`. (4) Requires a live migrated Postgres (`pnpm db:migrate` first).
- **VALIDATE**: `npx vitest run tests/reschedule-core.test.ts tests/portal-scope.test.ts` green.

### Task 15: Privacy/consent content + PRD split
- **ACTION**: Extend `/privacy`; split Phase 7 in the PRD.
- **IMPLEMENT**:
  - `src/app/privacy/page.tsx`: add sections — **监护人同意**（minors: parent consents on the child's behalf; the login write path), **数据保留期限**, **处理的法律依据（同意/履行服务）**, and **登录账号与改期申请** (what the authenticated portal collects: login credentials, reschedule requests + reasons). Keep the existing inline-style + `robots:noindex`.
  - PRD `.claude/PRPs/prds/course-scheduling-system.prd.md`: replace the Phase 7 row with **7a** (this slice: 多角色登录门户 + 改期申请→审批 + RBAC 硬化 + 数据处理告知; status `in-progress`; PRP link to this plan) and add **7b** Reminders/Notifications, **7c** MCP OAuth 2.1, **7d** (optional) Google two-way sync, **7e** Payments/Credits — all `pending`, `Depends 7a`. Update **Phase Details** + **Parallelism Notes** accordingly.
- **MIRROR**: `PRIVACY_NOTICE_CURRENT`; PRD table format.
- **IMPORTS**: n/a.
- **GOTCHA**: Keep consent-copy factual and PIPL-aligned; the gate (Task 11) references this page.
- **VALIDATE**: `/privacy` renders the new sections; PRD table parses; the plan link resolves.

---

## Testing Strategy

### Unit / Integration Tests
| Test | Input | Expected | Edge? |
|---|---|---|---|
| RBAC: parent create | `can('parent', { rescheduleRequest: ['create'] })` | `true` | — |
| RBAC: parent approve denied | `can('parent', { rescheduleRequest: ['approve'] })` | `false` | ✅ |
| RBAC: parent lesson:update denied | `can('parent', { lesson: ['update'] })` | `false` | ✅ |
| RBAC: teacher approve | `can('teacher', { rescheduleRequest: ['approve'] })` | `true` | — |
| create request (happy) | linked+enrolled student, future slot | row `pending`, `studentId`+`requestedById` set | — |
| create — unlinked student | parent A requests child B | throws `无权访问该学生` | ✅ |
| create — not enrolled | student not in lesson's section | throws `该学生未在此班级` | ✅ |
| approve (free slot) | pending request | lesson moved, request `approved`, `reviewedBy/At` set | — |
| approve (conflict) | requested time overlaps teacher's other lesson | `{ok:false}`, request stays `pending`, lesson unmoved | ✅ |
| reject | pending request | `rejected` | — |
| cancel by non-owner | other user cancels | throws `无权取消该申请` | ✅ |
| double-process | approve an already-approved request | throws `申请已处理` | ✅ |
| scope resolve | `resolveLinkedStudentIds(parentA)` | only A's child ids | ✅ |
| other-child IDOR | `assertLinkedToStudent(parentA, childB)` | throws | ✅ |
| cross-tenant | parent of org A vs student of org B | no leakage | ✅ |
| provision | `provisionPortalAccount` | user + member(role='parent') + portalLink; exactly ONE membership | ✅ |

### Edge Cases Checklist
- [ ] No-email parent → synthesized placeholder email, login works
- [ ] Provisioned user does NOT get a self-owned org (hook branch)
- [ ] `inArray([])` guard when a linked student has no active enrollment
- [ ] Approve after a GiST race throws `ConflictError` (handled, request stays pending)
- [ ] Consent gate shows once, then never again
- [ ] Parent with multiple children sees all their children, no others

---

## Validation Commands

### Static Analysis
```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
```
EXPECT: zero errors.

### Migration
```bash
pnpm db:generate && pnpm db:migrate
```
EXPECT: `0006_*.sql` adds `portal_relationship` + `portal_link` + `reschedule_request.student_id`; migrate is idempotent; no enum re-creation.

### Unit / Integration Tests
```bash
npx vitest run tests/rbac-reschedule.test.ts
npx vitest run tests/reschedule-core.test.ts tests/portal-scope.test.ts   # need live migrated Postgres
```
EXPECT: all green.

### Full Suite (no regressions)
```bash
pnpm test        # vitest run — Postgres up + migrated
```
EXPECT: existing suites (conflict/report-db/tenant-isolation/mcp-tools/…) still pass.

### Build
```bash
SKIP_ENV_VALIDATION=1 pnpm build
```
EXPECT: clean production build.

### Manual (browser)
```bash
pnpm dev
```
- [ ] Owner: dashboard → 学生 → 开通家长登录 → get login email
- [ ] Log out; log in as the parent → dispatched to `/portal`; consent gate once
- [ ] `/portal` shows only that child's upcoming lessons
- [ ] `/portal/reschedule`: create a request → `待处理`; cancel works
- [ ] Owner: `/dashboard/reschedule` → approve → lesson moves on `/dashboard/schedule`; conflicting approve shows conflicts + stays pending; reject works
- [ ] A second parent cannot see the first family's data

---

## Acceptance Criteria
- [ ] Owner can provision `parent`/`student` logins (no-email OK); provisioned users are members of the tutor's org (not self-owned)
- [ ] Parent/student log in → `/portal`, see ONLY their linked student(s)
- [ ] Parent/student create + cancel reschedule requests; cannot approve or edit lessons
- [ ] Teacher/admin approve (moves lesson via `rescheduleLessonCore`, same conflict check) / reject; conflicts surfaced, not silently applied
- [ ] Row-level isolation proven (other-child + cross-tenant tests green)
- [ ] `/privacy` extended for minors/consent; consent captured at first portal login
- [ ] Migration 0006 applies cleanly; all validation commands pass; PRD Phase 7 split into 7a–7e

## Completion Checklist
- [ ] Follows `WRITE_ACTION_4STEP_TEMPLATE` + `data.ts` loader convention
- [ ] All tenant access via `forTenant(ctx)` (no raw `db.*` on the authed path)
- [ ] Row-scope derived only from `portalLink`/`enrollment`, never request params
- [ ] Cores headless (no `requireAuthContext`/`revalidatePath`); actions own those
- [ ] Chinese error messages + typed PG-code helpers (`isExclusionViolation`)
- [ ] `member.role` stored literally `'parent'`/`'student'`
- [ ] Both lockfiles unchanged (no new deps) — verify
- [ ] Self-contained — no codebase searching needed to implement

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `user.create.after` hook branch mis-detects endpoint → portal user self-tenants (or self-signup breaks) | M | H | Task 0 verifies `context.path` in installed 1.7.4; fallback `additionalFields.isPortalUser`; test both paths (self-signup still `/dashboard`; provisioned has 1 membership). |
| `auth.api.createUser`/`addMember` needs a session server-side / enforces caller RBAC | M | M | Task 0 verifies; pass `headers: await headers()` (acting owner) if required; the action already gates with `requirePermission`. |
| Row-level scope missed on a portal query → cross-family leak | L | H | Single choke-point (`resolveLinkedStudentIds`/`assertLinkedToStudent`); dedicated other-child IDOR test; no RLS backstop so review every portal query. |
| Approve races the GiST constraint (23P01) | L | M | `rescheduleLessonCore` already catches → `ConflictError`; approve leaves request pending; covered by conflict test. |
| No-email placeholder emails collide/pollute | L | L | `nanoid()` + operator-owned `PORTAL_EMAIL_DOMAIN`; `user.email` UNIQUE catches collisions (surfaced as a Chinese error). |
| Scope creep back toward full Phase 7 | M | M | NOT-Building + PRD 7b–7e split make the boundary explicit. |

## Notes
- **No new dependencies** — Better-Auth `admin`+`organization` plugins are already configured; the whole slice is schema + app code.
- **Two-PR split** (Metadata) keeps PR-1 fully headless-testable (server cores + provisioning + RBAC) and PR-2 purely UI, matching how Phases 5/6 landed.
- **Future (7b+)**: notifying parents on approve, per-child `.ics`/PNG in the portal, username-plugin login for WeChat parents, org-switching for multi-tutor families.
