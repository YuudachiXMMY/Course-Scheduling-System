# Plan: 教务工作台与家长门户增强（5 项功能）

## Summary
一次性交付 5 项跨栈功能：(1) 教务工作台笔记点评内新增每生"出勤"提交；(2) 为每个班级生成"排课浏览"分享链接（镜像现有学生分享链接）；(3) 用户与班级列表展示创建/最近修改日期；(4) 家长/学生门户把"我的课表"改为"课表"并让家长可筛选孩子；(5) 家长门户新增可查看/筛选学生进度报告的页面。功能 1、3、4 主要复用已有后端；功能 2 需一张新表 + 公开路由；功能 5 是门户侧全新页面 + 一处 RBAC 放权。

## User Story
- 作为**教师/助教**，我想在批改点评与成绩的同一处直接标记每个学生的出勤，这样课后录入无需切换到"排课"详情抽屉。
- 作为**教务管理者**，我想为整个班级生成一个只读排课分享链接，方便把班级课表发给一组家长，而不必逐个学生分享。
- 作为**任何工作台用户**，我想看到用户和班级的创建时间与最近修改时间，以便审计与排查。
- 作为**家长**，我登录后想看到清晰的"课表"，并在有多个孩子时按孩子筛选；我还想查看孩子的进度报告并按孩子或课程/班级筛选。

## Problem → Solution
- 出勤后端已存在于"排课"模块，但教务工作台的内联点评/成绩编辑器里没有出勤入口 → 把已有 `upsertAttendance` 能力接入 `lesson-notes-inline.tsx`。
- 学生有 per-student 分享链接，班级没有 → 镜像整套机制到 per-section。
- `user`/`classSection` 表都有时间戳，但列表/详情 UI 未展示 → 在查询与渲染层补上。
- 门户把每个孩子平铺为一张课表卡、文案为"我的课表"、且没有报告页 → 加客户端筛选、改文案、新建报告页。

## Metadata
- **Complexity**: Large（5 项功能，约 30 个文件，1 张新表 + 1 个迁移，1 处 RBAC 变更）
- **Source PRD**: N/A（来自用户自由描述）
- **PRD Phase**: N/A
- **Estimated Files**: ~30（新增 ~9，修改 ~21）

> 本计划可按功能拆成 5 个独立 PR 分批实现（功能间几乎无耦合，仅共享基础设施）。推荐实现顺序：3 → 1 → 4 → 5 → 2（先做零/低风险，再做新表）。

---

## UX Design

### 功能1：教务工作台 · 出勤

**Before**
```
教务工作台 → 班级 → 排课 tab → 展开某节课
┌─────────────────────────────────────────┐
│ 学生点评 & 成绩                            │
│ ┌ 张三 ───────────────────────────────┐ │
│ │ 点评: [textarea............]          │ │
│ │ 成绩: [分数] / [满分]   [保存点评][保存成绩]│
│ └──────────────────────────────────────┘ │
└─────────────────────────────────────────┘
（出勤只能去"排课"页的课节详情抽屉里点）
```

**After**
```
┌─────────────────────────────────────────┐
│ 学生点评 & 成绩                            │
│ ┌ 张三 ───────────────────────────────┐ │
│ │ 出勤: (出勤)(缺席)(迟到)(请假)  ← 新增   │ │
│ │ 点评: [textarea............]          │ │
│ │ 成绩: [分数] / [满分]                  │ │
│ └──────────────────────────────────────┘ │
│                       [一键保存全部更改]    │
└─────────────────────────────────────────┘
```

### 功能2：班级分享链接（镜像学生分享）

**Before**：仅"导出"tab 里两个 ZIP 下载链接。学生分享链接在 `用户管理→学生` 每行的 ExportPanel。
**After**：班级"导出"tab 内新增一块"排课分享链接"，按钮组 `生成/复制/重新生成/停用`，展示 `https://<origin>/sec/<token>`。公开页 `/sec/<token>` 无需登录即可看整班课表。

### 功能3：创建/修改日期

**Before**：用户行显示 `姓名 · 角色 · 邮箱`；班级只显示名称。
**After**：用户行加 `创建于 2026-01-05 · 最近修改 2026-09-10`；班级设置页加同样一行。

### 功能4：门户课表

**Before**：H2「我的课表」+ 导航「我的课表」；多个孩子平铺多张卡，无筛选。
**After**：H2/导航改为「课表」；多孩家长头部出现「全部 / 张三 / 李四」筛选（默认全部）。

### 功能5：门户报告（全新）

**After**：门户导航新增「进度报告」；页面列出已审批(approved)报告，顶部两个下拉：按孩子、按课程/班级（均默认全部）。

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| 工作台内联编辑器 | 点评+成绩 | +四态出勤按钮 | 复用 `upsertAttendance` |
| 班级导出 tab | 仅 ZIP 下载 | +分享链接管理 | 镜像学生 ExportPanel |
| 用户列表行 | 姓名/角色/邮箱 | +创建/修改日期 | flex 列表，非表格 |
| 班级设置页 | 表单 | +时间戳一行 | classSection 已有字段 |
| 门户课表页 | 平铺全部卡 | 多孩加筛选 | client `useState`+`filter` |
| 门户导航 | 课表/改期/通知 | +进度报告 | 新路由 `/portal/reports` |

---

## Mandatory Reading

Files that MUST be read before implementing:

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/db/tenant.ts` | 25-135 | `forTenant(ctx)` 是唯一合规租户读写通道，无 upsert（关键） |
| P0 | `src/auth/context.ts` | 14-66 | `AuthContext`、`requireAuthContext()` |
| P0 | `src/auth/authorize.ts` | 8-17 | `can()`、`requirePermission()` |
| P0 | `src/auth/permissions.ts` | 31-84 | 角色权限矩阵；parent 当前无 report 权限（功能5 要改） |
| P0 | `src/auth/portal.ts` | 12-44 | `isPortalRole`/`resolveLinkedStudentIds`/`requireConsent`（功能4/5 基础） |
| P0 | `src/lib/errors.ts` | all | `BusinessError`/`toPortalActionError`/`ConflictError` |
| P1 | `src/app/dashboard/schedule/attendance-actions.ts` | 56-98 | `upsertAttendance` 复用源（功能1） |
| P1 | `src/app/dashboard/schedule/lesson-detail.tsx` | 16-21, 259-286 | 出勤四态标签 + 按钮渲染范例（功能1） |
| P1 | `src/app/dashboard/teach/[sectionId]/lesson-notes-inline.tsx` | 75-156, 191-250 | 出勤 UI 插入点 + saveAll 批量保存（功能1） |
| P1 | `src/app/dashboard/teach/[sectionId]/data.ts` | 69-81, 195-235 | `LessonNoteRow` 类型 + 批量加载器（功能1） |
| P1 | `src/db/schema/share-link.ts` | all | 分享表模板（功能2） |
| P1 | `src/app/dashboard/students/share-actions.ts` | all | 生成/轮换/撤销 action 模板（功能2） |
| P1 | `src/app/dashboard/students/share-data.ts` | all | forTenant spine 数据层模板（功能2） |
| P1 | `src/app/dashboard/students/export-panel.tsx` | all | 客户端分享 UI 模板（功能2） |
| P1 | `src/app/s/[token]/page.tsx` + `not-found.tsx` | all | 无鉴权公开页模板（功能2） |
| P1 | `src/lib/share.ts` | 26-138 | `sliceLessonsForSections` 纯切片 + 公开读范例（功能2） |
| P1 | `src/app/dashboard/users/data.ts` | 9-70 | 用户查询（功能3 加时间戳字段） |
| P1 | `src/app/dashboard/users/teachers-tab.tsx` | 42-67 | 用户行渲染模板（功能3） |
| P1 | `src/app/portal/data.ts` | 20-41 | `getPortalSchedule`（功能4） |
| P1 | `src/app/portal/page.tsx` + `layout.tsx` | all | 门户页/导航（功能4/5） |
| P1 | `src/app/dashboard/reports/data.ts` | 26-58 | 报告查询模板（功能5 改 scope） |
| P1 | `src/app/dashboard/reports/report-panel.tsx` | 84-96 | 下拉筛选范例（功能4/5） |
| P2 | `src/db/schema/course.ts` | 37-76 | classSection 字段（含时间戳） |
| P2 | `src/db/schema/progress-report.ts` | 20-62 | report 字段 studentId/sectionId/status |
| P2 | `src/db/schema/portal-link.ts` | all | 家长↔孩子 join 表 |
| P2 | `tests/share-slicing.test.ts` | all | 纯逻辑测试模板 |
| P2 | `tests/report-data-scope.test.ts` | all | DB 集成测试模板（seedOrg/unseedOrg） |
| P2 | `next.config.ts` | 20-27 | `/s/:token*` X-Robots-Tag（功能2 加 `/sec/`） |
| P2 | `drizzle.config.ts` + `drizzle/` | — | 迁移生成（功能2，新表 → 0017） |

## External Documentation

无需外部研究——全部使用已建立的内部模式（Drizzle + better-auth + Next 16 Server Actions + luxon）。项目自带离线 Next 文档于 `node_modules/next/dist/docs/`（见 AGENTS.md：本仓库 Next 16 有 breaking changes，写路由/RSC 前应查）。

| Topic | Source | Key Takeaway |
|---|---|---|
| Next 16 RSC 约定 | `node_modules/next/dist/docs/` | `params`/`searchParams` 均为 `Promise`，必须 `await` |
| luxon 时区格式化 | 内部约定 `src/lib/timezone.ts` | `DateTime.…setZone(APP_TIME_ZONE).toFormat(...)` |

---

## Patterns to Mirror

### NAMING_CONVENTION
```
// SOURCE: src/app/dashboard/students/share-actions.ts, share-data.ts, grade-actions.ts
// - Server Action 文件：就近放路由目录，命名 actions.ts 或 <领域>-actions.ts，文件顶 'use server'
// - 纯 DB/逻辑 core：同目录 data.ts 或 src/lib/*-core.ts（'use server' 模块只能导出 async 函数）
// - 类型：PascalCase（LessonNoteRow / StaffRow / PortalCard）；函数：camelCase 动词短语
// - Drizzle 表：snake_case 表名（class_section / share_link），导出 camelCase（classSection / shareLink）
```

### ERROR_HANDLING（两套边界，务必区分）
```ts
// SOURCE: src/app/dashboard/schedule/attendance-actions.ts:64（内部/员工边界）
// 员工 Server Action：直接 throw new Error('中文消息')；客户端 try/catch 后显示中文兜底
export async function upsertAttendance(input) {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['update'] })
  const data = attendanceSchema.parse(input)                 // zod
  if (!(await actorOwnsLesson(ctx, data.lessonId))) throw new Error('无权记录该课节考勤')
  // ...forTenant 读写...
  revalidatePath('/dashboard/schedule'); return row
}

// SOURCE: src/lib/errors.ts + src/app/portal/reschedule/actions.ts（外部/门户边界）
// 门户 Server Action：面向不可信 parent/student，必须 return toPortalActionError(e, fallback)
// → { ok:false, error } —— 只转发 BusinessError/ConflictError/AuthError 的安全中文消息
```

### LOGGING_PATTERN
```ts
// SOURCE: src/lib/errors.ts:toPortalActionError
// 仅在门户边界兜底处 console.error('portal action failed', e)；其余走异常/领域错误，不额外打点
```

### REPOSITORY_PATTERN（唯一合规租户读写）
```ts
// SOURCE: src/db/tenant.ts:25 —— 禁止对 tenant 表裸 db.select/insert（会跨租户，无 RLS 兜底 M1）
forTenant(ctx).select(table, extraWhere?)      // 返回 Row[]，可链式 .orderBy().limit().offset()
forTenant(ctx).findById(table, id)             // Row | null
forTenant(ctx).insert(table, values)           // 强制注入 tenantId，返回 [row]
forTenant(ctx).update(table, id, values)       // 剥离 tenantId/id，返回 [row]
forTenant(ctx).delete(table, id) / deleteWhere(table, extra) / count(table, extra?)
// ⚠️ 无 upsert：需要 upsert 时用 raw db.insert(...).onConflictDoUpdate({target,set})
//    并在 values 里 EXPLICIT 写 tenantId（见 push-core.ts:97-111 的 M1 例外注释）
```

### UPSERT_PATTERN（forTenant 例外）
```ts
// SOURCE: src/lib/push-core.ts:97-111 —— 原子 upsert，冲突目标含 tenant，写值显式带 tenantId
await db.insert(pushSubscription)
  .values({ tenantId: ctx.tenantId, userId: ctx.userId, endpoint, p256dh, auth })
  .onConflictDoUpdate({
    target: [pushSubscription.tenantId, pushSubscription.userId, pushSubscription.endpoint],
    set: { p256dh, auth, updatedAt: new Date() },
  })
// NB：功能1 出勤沿用现有 upsertAttendance 的 select-then-write（已存在，无需改成 onConflict）
```

### PARENT→CHILDREN 查询（功能4/5 核心）
```ts
// SOURCE: src/auth/portal.ts:20 —— 行级 scope 只来自验证过的 ctx.userId，绝不来自请求参数
export async function resolveLinkedStudentIds(ctx: AuthContext): Promise<string[]> {
  const rows = await forTenant(ctx).select(portalLink, eq(portalLink.userId, ctx.userId))
  return rows.map((r) => r.studentId)   // 多孩家长 = 多行；学生 = 自身 1 行
}
// 写路径归属守卫：assertLinkedToStudent(ctx, studentId)（portal.ts:26）
```

### CLIENT_FILTER_PATTERN（功能4/5 下拉筛选）
```tsx
// SOURCE: src/app/dashboard/reports/report-panel.tsx:84-96（client useState + <select onChange>）
const [studentId, setStudentId] = useState('')  // '' = 全部
<select aria-label="选择学生" value={studentId} onChange={(e) => setStudentId(e.target.value)}
  className="rounded border border-neutral-300 px-2 py-1.5 text-sm">
  <option value="">全部</option>
  {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
</select>
// 列表本身：cards.filter(c => !studentId || c.studentId === studentId)
// 约定：行内即时筛选用 client state + array.filter，不引入 URL searchParams（后者仅用于页级 tab）
```

### DATE_FORMAT_PATTERN（功能3）
```tsx
// SOURCE: src/app/dashboard/notifications/notification-panel.tsx:8-15（ISO 字符串输入）
import { DateTime } from 'luxon'
import { APP_TIME_ZONE } from '@/lib/timezone'
DateTime.fromISO(iso, { zone: 'utc' }).setZone(APP_TIME_ZONE).toFormat('MM月dd日 HH:mm')
// SOURCE: src/lib/schedule-card.tsx:25（JSDate 输入）
DateTime.fromJSDate(d, { zone: 'utc' }).setZone(APP_TIME_ZONE)
// ⚠️ 输入源不同：user 时间戳是字符串(auth-schema 无 mode) → fromISO；
//    classSection 时间戳是 Date(_helpers mode:'date') → fromJSDate
```

### TEST_STRUCTURE
```ts
// 纯逻辑 —— SOURCE: tests/share-slicing.test.ts
import { describe, it, expect } from 'vitest'
// 造 fabricated rows 覆盖每个过滤分支，直接断言纯函数输出

// DB 集成 —— SOURCE: tests/report-data-scope.test.ts
import { seedOrg, unseedOrg } from './helpers/seed-org'
const ctx: AuthContext = { tenantId: org, userId, role: 'owner', isPlatformAdmin: false }
beforeAll(async () => { await cleanup(); await seedOrg(org); /* insert 夹具 */ })
afterAll(cleanup)  // 逐表 db.delete(...).where(eq(table.tenantId, org)) + unseedOrg
```

---

## Files to Change

### 功能1 — 出勤（无 schema 变更）
| File | Action | Justification |
|---|---|---|
| `src/app/dashboard/teach/[sectionId]/data.ts` | UPDATE | `LessonNoteRow` 加 `attendance: Record<studentId,status>`；`getSectionLessonNotes` 批量 select attendance |
| `src/app/dashboard/teach/[sectionId]/lesson-notes-inline.tsx` | UPDATE | 每生卡片加四态出勤按钮 + seed state + 提交 + 并入 saveAll |
| `src/app/dashboard/teach/[sectionId]/section-lessons.tsx` | UPDATE | `initial` 默认值加 `attendance: {}` |
| `src/app/dashboard/teach/[sectionId]/attendance-actions.ts` | CREATE（可选） | 薄 wrapper，revalidate `/dashboard/teach`；或直接复用 schedule 的 action + `router.refresh()` |
| `tests/teach-attendance.test.ts` | CREATE | 出勤 upsert/加载的 DB 集成测试 |

### 功能2 — 班级分享链接（新表）
| File | Action | Justification |
|---|---|---|
| `src/db/schema/section-share-link.ts` | CREATE | 镜像 share-link.ts，per-section |
| `src/db/schema/index.ts` | UPDATE | `export * from './section-share-link'` |
| `src/db/schema/relations.ts` | UPDATE | `sectionShareLinkRelations` → classSection |
| `drizzle/0017_*.sql` | CREATE | `drizzle-kit generate` 产出 |
| `src/app/dashboard/teach/[sectionId]/section-share-data.ts` | CREATE | forTenant spine（getActive/ensureActive） |
| `src/app/dashboard/teach/[sectionId]/section-share-actions.ts` | CREATE | getOrCreate/rotate/revoke，actorOwnsSection 守卫 |
| `src/app/dashboard/teach/[sectionId]/section-share-panel.tsx` | CREATE | client 分享 UI（镜像 students/export-panel.tsx） |
| `src/app/dashboard/teach/[sectionId]/tabs/export-panel.tsx` | UPDATE | 挂载 SectionSharePanel + 读 token |
| `src/lib/share.ts` | UPDATE | `getSectionShareByToken` + `getSectionScheduleForShare` |
| `src/app/sec/[token]/page.tsx` | CREATE | 无鉴权公开班级课表页 |
| `src/app/sec/[token]/not-found.tsx` | CREATE | 含糊 404 |
| `next.config.ts` | UPDATE | `/sec/:token*` X-Robots-Tag noindex |
| `tests/section-share-slicing.test.ts` | CREATE | 公开切片逻辑测试 |

### 功能3 — 创建/修改日期（无 schema 变更）
| File | Action | Justification |
|---|---|---|
| `src/lib/format-datetime.ts` | CREATE | 统一 `formatDateTime(value: Date|string|null)` helper |
| `src/app/dashboard/users/data.ts` | UPDATE | staff/portal 查询 select 加 `user.createdAt/updatedAt`；类型加字段 |
| `src/app/dashboard/users/teachers-tab.tsx` | UPDATE | 行内展示时间戳 |
| `src/app/dashboard/users/admins-tab.tsx` | UPDATE | 同上 |
| `src/app/dashboard/users/students-tab.tsx` | UPDATE | 同上 |
| `src/app/dashboard/users/parents-tab.tsx` | UPDATE | 同上 |
| `src/app/dashboard/teach/[sectionId]/tabs/settings-panel.tsx` | UPDATE | 班级设置区加"创建于 X · 最近修改 Y" |
| `tests/format-datetime.test.ts` | CREATE | helper 纯逻辑测试 |

### 功能4 — 门户课表文案 + 筛选（无 schema 变更）
| File | Action | Justification |
|---|---|---|
| `src/app/portal/page.tsx` | UPDATE | H2「我的课表」→「课表」；把卡片渲染下放给 client 筛选组件 |
| `src/app/portal/layout.tsx` | UPDATE | 导航「我的课表」→「课表」 |
| `src/app/portal/schedule-cards.tsx` | CREATE | client：默认全部，多孩加 `<select>` 按 studentId 筛选 |

### 功能5 — 门户报告（全新页面 + 1 处放权）
| File | Action | Justification |
|---|---|---|
| `src/auth/permissions.ts` | UPDATE | parent（及 student）角色加 `report: ['read','list']` |
| `src/app/portal/reports/data.ts` | CREATE | scope=resolveLinkedStudentIds，仅 approved，返回筛选选项 |
| `src/app/portal/reports/page.tsx` | CREATE | 鉴权 + requireConsent + 渲染列表组件 |
| `src/app/portal/reports/reports-list.tsx` | CREATE | client：按学生 / 按课程班级 双下拉筛选 |
| `src/app/portal/layout.tsx` | UPDATE | 导航加「进度报告」入口 |
| `tests/portal-report-scope.test.ts` | CREATE | 家长只见自己孩子的 approved 报告 |

## NOT Building
- **门户 PDF 下载**（功能5）：v1 仅在页面内渲染报告 narrative + 元信息；`src/app/api/reports/[reportId]/pdf/route.ts` 的鉴权目前面向员工，改造成家长可访问属独立工作项，列为后续。
- **出勤的独立新 UI/新 action**（功能1）：不重写后端，复用 schedule 的 `upsertAttendance`。
- **把班级分享链接放进左侧 `course-tree.tsx`**（功能2）：空间不足，统一放"导出"tab。
- **`ScheduleCard` 组件重构**（功能2）：不改其"{studentName} 的课表"文案语义，班级名直接传入 `studentName`（如需"班级课表"字样，作为可选小改，见 Task 2.6 GOTCHA）。
- **草稿(draft)报告对家长可见**（功能5）：门户只查 `status='approved'`。
- **member 表的 updatedAt**（功能3）：member 无 updatedAt，用户时间戳统一取 `user` 表。
- **URL searchParams 筛选**（功能4/5）：行内筛选用 client state。

---

## Step-by-Step Tasks

### ——— 功能3：创建/修改日期（先做，零风险，无 schema 变更）———

### Task 3.1: 新建统一日期格式化 helper
- **ACTION**: 创建 `src/lib/format-datetime.ts`
- **IMPLEMENT**:
  ```ts
  import { DateTime } from 'luxon'
  import { APP_TIME_ZONE } from './timezone'
  // 同时接受 Date（业务表 mode:'date'）与 ISO string（auth 表无 mode）与 null。
  export function formatDateTime(value: Date | string | null | undefined): string {
    if (!value) return '—'
    const dt = typeof value === 'string'
      ? DateTime.fromISO(value, { zone: 'utc' })
      : DateTime.fromJSDate(value, { zone: 'utc' })
    return dt.setZone(APP_TIME_ZONE).toFormat('yyyy-MM-dd HH:mm')
  }
  ```
- **MIRROR**: DATE_FORMAT_PATTERN（notification-panel.tsx:8-15 + schedule-card.tsx:25）
- **IMPORTS**: `luxon`、`@/lib/timezone`
- **GOTCHA**: 该文件被 Client Component 引用，**不要**加 `'server-only'`；luxon 纯 JS，客户端安全。
- **VALIDATE**: `tests/format-datetime.test.ts` 断言字符串与 Date 两种输入、null → '—'。

### Task 3.2: 用户查询补时间戳
- **ACTION**: 编辑 `src/app/dashboard/users/data.ts`
- **IMPLEMENT**: 在 staff 查询（:57-70）与 portal 查询（:20-25）的 `.select({...})` 各加 `createdAt: user.createdAt, updatedAt: user.updatedAt`；`StaffRow`（:45-51）与 `PortalUserRow`（:9-15）类型加 `createdAt: string; updatedAt: string`（auth 表返回字符串）。
- **MIRROR**: 现有 select 结构
- **GOTCHA**: `user.createdAt/updatedAt` 是**字符串**（auth-schema.ts 未设 mode），类型标 `string` 而非 `Date`。
- **VALIDATE**: `pnpm typecheck` 通过；查询返回含时间戳。

### Task 3.3: 用户列表行展示时间戳（4 个 tab）
- **ACTION**: 编辑 `teachers-tab.tsx`（:42-67）、`admins-tab.tsx`、`students-tab.tsx`、`parents-tab.tsx`
- **IMPLEMENT**: 在每行 `flex flex-col` 块内、邮箱下方加一行：
  ```tsx
  <span className="text-xs text-neutral-400">
    创建于 {formatDateTime(s.createdAt)} · 最近修改 {formatDateTime(s.updatedAt)}
  </span>
  ```
- **MIRROR**: teachers-tab.tsx:42-67 的行结构
- **IMPORTS**: `import { formatDateTime } from '@/lib/format-datetime'`
- **GOTCHA**: 四个 tab 结构一致但字段来源不同（staff vs portal 查询），确认对应 Row 类型已含时间戳。
- **VALIDATE**: 浏览器看每行显示日期；空值显示 '—'。

### Task 3.4: 班级设置页展示时间戳
- **ACTION**: 编辑 `src/app/dashboard/teach/[sectionId]/tabs/settings-panel.tsx`
- **IMPLEMENT**: 在"班级设置"区加一行 `创建于 {formatDateTime(section.createdAt)} · 最近修改 {formatDateTime(section.updatedAt)}`。`classSection` 时间戳是 **Date**，helper 已兼容。
- **MIRROR**: settings-panel 现有区块；classSection 数据来自 `listSections()`（courses/actions.ts:116-128，已含时间戳）
- **GOTCHA**: 确认 settings-panel 能拿到完整 `classSection` 行（含时间戳）；若只传了部分字段需补传。
- **VALIDATE**: 班级设置页显示创建/修改时间。

### ——— 功能1：教务工作台出勤 ———

### Task 1.1: 批量加载器加入出勤
- **ACTION**: 编辑 `src/app/dashboard/teach/[sectionId]/data.ts`
- **IMPLEMENT**:
  1. `LessonNoteRow`（:195）加字段 `attendance: Record<string, string>`（studentId → status）。
  2. `getSectionLessonNotes`（:206-235）加一次批量查询：`const atts = await forTenant(ctx).select(attendance, inArray(attendance.lessonId, lessonIds))`，按 lessonId 归组塞入每个 `LessonNoteRow.attendance`（`{ [studentId]: status }`）。
- **MIRROR**: 同函数内 note/grade 的 `inArray(..., lessonIds)` 批量加载写法
- **IMPORTS**: `attendance` from `@/db/schema`；`inArray` from `drizzle-orm`（已导入）
- **GOTCHA**: `lessonIds` 为空时 `inArray([])` 是非法 SQL——沿用现有对空数组的早返回/守卫。
- **VALIDATE**: `pnpm typecheck`；打印某 section 的 notes 含 attendance 映射。

### Task 1.2: 出勤 Server Action（复用或薄 wrapper）
- **ACTION**: 决定复用 `schedule/attendance-actions.ts:upsertAttendance`（它 revalidate `/dashboard/schedule`，teach 侧靠 `router.refresh()`）；如需精确 revalidate，创建 `src/app/dashboard/teach/[sectionId]/attendance-actions.ts` 薄 wrapper：
- **IMPLEMENT**（若建 wrapper）:
  ```ts
  'use server'
  import { revalidatePath } from 'next/cache'
  import { upsertAttendance } from '@/app/dashboard/schedule/attendance-actions'
  export async function upsertTeachAttendance(input) {
    const row = await upsertAttendance(input)     // 已含鉴权/zod/归属/写库
    revalidatePath('/dashboard/teach')
    return row
  }
  ```
- **MIRROR**: attendance-actions.ts:64；grade-actions.ts 的复用式导入（lesson-notes-inline.tsx:5 已从 schedule 导入 note action）
- **GOTCHA**: 权限沿用 `lesson:['update']`（`canManage` 已由 lessons-panel.tsx:23 传入）；`actorOwnsLesson` 已在底层 action 内做，勿重复。
- **VALIDATE**: 调用后 attendance 表出现/更新行，`recordedBy = ctx.userId`。

### Task 1.3: 内联编辑器加出勤按钮
- **ACTION**: 编辑 `src/app/dashboard/teach/[sectionId]/lesson-notes-inline.tsx`
- **IMPLEMENT**:
  1. 顶部定义 `const STATUS_LABELS = { present:'出勤', absent:'缺席', late:'迟到', excused:'请假' }`（照抄 lesson-detail.tsx:16-21）。
  2. 用 `initial.attendance` seed 一个 `attendance` state（`Record<studentId,status>`）。
  3. 每生卡片（:209 附近，成绩上方）渲染四态按钮组，选中态 `aria-pressed` 高亮（照抄 lesson-detail.tsx:259-286）。
  4. 点击 → `startTransition(async () => { try { await upsert…({lessonId, studentId, status}); setAttendance(...); router.refresh() } catch { setError(...) } })`。
  5. 并入 `saveAll`（:93-156）脏检查：把变更过的出勤一起提交。
- **MIRROR**: lesson-detail.tsx:16-21 & 259-286（按钮）；lesson-notes-inline.tsx:75-86（saveGrade 的 transition + router.refresh 惯例）
- **IMPORTS**: 出勤 action（Task 1.2）
- **GOTCHA**: B30 教训——`startTransition` 内每个 `await` 必须 `try/catch` 落到 `setError`，否则 rejection 冒泡被生产 React #441 脱敏；复用的 action 只 revalidate schedule，teach 侧必须 `router.refresh()` 才刷新 RSC。
- **VALIDATE**: 点按钮→高亮持久（刷新后仍在）；一键保存全部含出勤。

### Task 1.4: `section-lessons.tsx` 默认值
- **ACTION**: 编辑 `src/app/dashboard/teach/[sectionId]/section-lessons.tsx`（:266）
- **IMPLEMENT**: `initial={notes[l.id] ?? { summary:'', comments:{}, grades:{}, attendance:{} }}`
- **VALIDATE**: 无 note 记录的课节也能标出勤，不报 undefined。

### ——— 功能4：门户课表文案 + 筛选 ———

### Task 4.1: 改文案「我的课表」→「课表」
- **ACTION**: 编辑 `src/app/portal/page.tsx:15`（H2）与 `src/app/portal/layout.tsx:37`（导航链接文字）
- **IMPLEMENT**: 两处文本改为「课表」；注释可选同步。
- **VALIDATE**: 门户页/导航显示「课表」；`grep -rn 我的课表 src/` 仅剩注释（或全清）。

### Task 4.2: 客户端课表筛选组件
- **ACTION**: 创建 `src/app/portal/schedule-cards.tsx`（`'use client'`），并在 `portal/page.tsx` 用它替换直接 `cards.map`
- **IMPLEMENT**:
  ```tsx
  'use client'
  import { useState } from 'react'
  import ScheduleCard from '@/lib/schedule-card'
  export default function ScheduleCards({ cards }: { cards: PortalCard[] }) {
    const [studentId, setStudentId] = useState('')  // '' = 全部
    const multi = cards.length > 1
    const shown = studentId ? cards.filter((c) => c.studentId === studentId) : cards
    return (<>
      {multi && (
        <select aria-label="选择孩子" value={studentId} onChange={(e)=>setStudentId(e.target.value)}
          className="mb-3 rounded border border-neutral-300 px-2 py-1.5 text-sm">
          <option value="">全部</option>
          {cards.map((c)=><option key={c.studentId} value={c.studentId}>{c.studentName}</option>)}
        </select>
      )}
      {shown.map((c)=><ScheduleCard key={c.studentId} data={{studentName:c.studentName, subtitle:c.subtitle, lessons:c.lessons}} />)}
    </>)
  }
  ```
- **MIRROR**: CLIENT_FILTER_PATTERN（report-panel.tsx:84-96）；page.tsx:16-23 现有 `cards.map`
- **GOTCHA**: 用 `cards.length > 1` 判断是否显示筛选（覆盖多孩家长；单孩/学生自动隐藏），无需读 relationship，简单且够用。`PortalCard` 类型从 `@/app/portal/data` 导入（`import type`）。
- **VALIDATE**: 多孩家长看到下拉、默认全部；单孩/学生无下拉；筛选切换正确。

### ——— 功能5：门户报告 ———

### Task 5.1: 给 parent/student 角色加 report 读权限
- **ACTION**: 编辑 `src/auth/permissions.ts`
- **IMPLEMENT**: `parent` 角色（:72-77）与 `student_role`（:78-82）各加 `report: ['read', 'list']`。
- **MIRROR**: 同文件 notification 权限行；`can()` 会对 comma-multi 角色逐一 authorize
- **GOTCHA**: 仅加 `read/list`，绝不给 create/update/approve；行级 scope 仍由数据层 `resolveLinkedStudentIds` 强制（权限 verb 只是第一道门）。
- **VALIDATE**: `rbac-*.test.ts` 风格：`can('parent', {report:['read']}) === true`，`can('parent', {report:['approve']}) === false`。

### Task 5.2: 门户报告数据加载器
- **ACTION**: 创建 `src/app/portal/reports/data.ts`（`import 'server-only'`）
- **IMPLEMENT**:
  ```ts
  export async function getPortalReports(ctx: AuthContext) {
    await requireConsent(ctx)                              // 门户同意门复检
    const ids = await resolveLinkedStudentIds(ctx)        // 该 user 的孩子/自身
    if (ids.length === 0) return { reports: [], students: [], sections: [] }
    const rows = await forTenant(ctx).select(progressReport,
      and(inArray(progressReport.studentId, ids), eq(progressReport.status, 'approved')))
    // 学生名 + section/course 名用于筛选选项（forTenant 查 student / classSection+course）
    // 组装 reports[]（含 studentName、sectionLabel）、students[]、sections[]
  }
  ```
- **MIRROR**: dashboard/reports/data.ts:26-58（把 `studentIdsForActor` 换成 `resolveLinkedStudentIds`，加 `status='approved'` 过滤）；section/course 拼名参考 lib/share.ts:67-81 `courseTitlesForSections`
- **IMPORTS**: `forTenant`、`progressReport`/`student`/`classSection`/`course`、`resolveLinkedStudentIds`/`requireConsent`、`and`/`eq`/`inArray`
- **GOTCHA**: `ids` 为空早返回（避免 `inArray([])`）；**只查 approved**（草稿不给家长）；section 可为 null（跨全程报告）——筛选选项要含"未分班/全程"或用 null-safe 标签。
- **VALIDATE**: `tests/portal-report-scope.test.ts`：家长只见自己孩子、只见 approved。

### Task 5.3: 门户报告页
- **ACTION**: 创建 `src/app/portal/reports/page.tsx`
- **IMPLEMENT**:
  ```tsx
  export default async function PortalReportsPage() {
    const ctx = await requireAuthContext()
    requirePermission(ctx, { report: ['read'] })
    const data = await getPortalReports(ctx)
    return <section className="space-y-4">
      <h2 className="text-lg font-semibold">进度报告</h2>
      <ReportsList {...data} />
    </section>
  }
  ```
- **MIRROR**: portal/page.tsx:8-24（鉴权 + requirePermission + 加载 + 渲染）
- **GOTCHA**: `requireConsent` 已在 data 层；页面层做 `requirePermission(report:read)`。被 portal/layout 的 ConsentGate 包裹。
- **VALIDATE**: 家长访问 `/portal/reports` 正常；非门户角色被 layout 弹到 /dashboard。

### Task 5.4: 报告列表 client 组件（双筛选）
- **ACTION**: 创建 `src/app/portal/reports/reports-list.tsx`（`'use client'`）
- **IMPLEMENT**: 两个 `<select>`（按孩子 studentId、按课程/班级 sectionId，默认全部 `''`）+ `reports.filter(r => (!sid||r.studentId===sid) && (!secId||r.sectionId===secId))`；每条渲染标题/周期/narrative 摘要。
- **MIRROR**: CLIENT_FILTER_PATTERN（report-panel.tsx:84-96）；功能4 的 schedule-cards.tsx
- **GOTCHA**: section 筛选选项含 `sectionId=null` 的报告（标"全程"）；筛选为纯前端，不发请求。
- **VALIDATE**: 双下拉联动过滤；默认全部。

### Task 5.5: 门户导航加入口
- **ACTION**: 编辑 `src/app/portal/layout.tsx` 的 `<nav>`（:35-63）
- **IMPLEMENT**: 在「改期申请」后加 `<Link href="/portal/reports">进度报告</Link>`。
- **MIRROR**: layout.tsx:39-44 现有 Link
- **GOTCHA**: 导航不区分家长/学生（两者共用门户）；因数据层按 `resolveLinkedStudentIds` 行级 scope，学生看到的是自己的 approved 报告——可接受。若产品要求"仅家长"，改为按 `portalLink.relationship` 条件渲染（记为可选）。
- **VALIDATE**: 门户导航出现「进度报告」，点击进入页面。

### ——— 功能2：班级分享链接（最后做，含新表/迁移）———

### Task 2.1: 新建 `section_share_link` 表
- **ACTION**: 创建 `src/db/schema/section-share-link.ts`
- **IMPLEMENT**: 镜像 `share-link.ts`，把 `studentId`→`sectionId`，FK 指向 `classSection`：
  ```ts
  export const sectionShareLink = pgTable('section_share_link', {
    id: primaryId(), tenantId: tenantId(),
    sectionId: text('section_id').notNull(),
    token: text('token').notNull(), label: text('label'),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(), updatedAt: updatedAt(),
  }, (t) => [
    uniqueIndex('uq_section_share_link_tenant_id').on(t.tenantId, t.id),
    uniqueIndex('uq_section_share_link_token').on(t.token),                    // 全局唯一（公开页仅凭 token）
    uniqueIndex('uq_section_share_link_active_section').on(t.tenantId, t.sectionId).where(sql`${t.revokedAt} is null`),
    foreignKey({ columns:[t.tenantId,t.sectionId], foreignColumns:[classSection.tenantId, classSection.id], name:'fk_section_share_link_section' }).onDelete('cascade'),
    index('idx_section_share_link_tenant_section').on(t.tenantId, t.sectionId),
  ])
  ```
- **MIRROR**: share-link.ts（逐行对应）
- **GOTCHA**: `uq_section_share_link_token` **不加** tenant 前缀（公开页只凭 token 查）；classSection 主键是 `(tenantId, id)` 复合，FK 用两列（见 share-link.ts 的复合 FK）。
- **VALIDATE**: `pnpm db:generate` 产出干净迁移。

### Task 2.2: 导出 + 关系 + 迁移
- **ACTION**: 编辑 `src/db/schema/index.ts`（加 `export * from './section-share-link'`）、`src/db/schema/relations.ts`（加 `sectionShareLinkRelations`：`one(classSection, { fields:[sectionShareLink.sectionId], references:[classSection.id] })`），运行 `pnpm db:generate`
- **MIRROR**: relations.ts:82-84（shareLinkRelations）
- **GOTCHA**: 迁移文件命名会是 `drizzle/0017_*.sql`；本变更纯 schema，**不涉及依赖**，无需动双 lockfile。
- **VALIDATE**: `drizzle/0017_*.sql` 只含 `CREATE TABLE section_share_link` + 索引；`pnpm db:migrate`（DB :5433）成功。

### Task 2.3: 数据层 `section-share-data.ts`
- **ACTION**: 创建 `src/app/dashboard/teach/[sectionId]/section-share-data.ts`（`import 'server-only'`）
- **IMPLEMENT**: `getActiveSectionShare(ctx, sectionId)`（`forTenant.select(sectionShareLink, and(eq(sectionId), isNull(revokedAt)))` → `[0]??null`）；`ensureActiveSectionShare(ctx, sectionId)`（无则 `insert(sectionShareLink, { sectionId, token: nanoid(32), label:'班级课表分享' })`）。
- **MIRROR**: students/share-data.ts:15-35（逐行对应）
- **IMPORTS**: `nanoid`、`forTenant`、`sectionShareLink`、`and/eq/isNull`
- **VALIDATE**: 幂等——两次 ensure 返回同一 token。

### Task 2.4: Server Action `section-share-actions.ts`
- **ACTION**: 创建 `src/app/dashboard/teach/[sectionId]/section-share-actions.ts`（`'use server'`）
- **IMPLEMENT**: `getOrCreateSectionShare`/`rotateSectionShare`/`revokeSectionShare`，结构照抄 students/share-actions.ts，把 `actorOwnsStudent`→`actorOwnsSection`、权限 tier 用 `lesson:['read']`（读）/`lesson:['update']`（写），`revalidatePath('/dashboard/teach/'+sectionId)`。
- **MIRROR**: students/share-actions.ts:18-65
- **IMPORTS**: `actorOwnsSection`（`@/auth/scope`，同步签名 `actorOwnsSection(ctx, section)`——确认它取 section 对象还是 id，必要时先 `forTenant.findById(classSection, id)`）
- **GOTCHA**: 员工边界——失败 `throw new Error('无权分享该班级课表')`，不用 toPortalActionError（那是门户边界）。rotate 用 `nanoid(32)` 换 token（旧链接立即 404）。
- **VALIDATE**: 生成/轮换/撤销三态；撤销后公开页 404。

### Task 2.5: 公开读逻辑 `lib/share.ts`
- **ACTION**: 编辑 `src/lib/share.ts`
- **IMPLEMENT**:
  - `getSectionShareByToken(token)`：`db.select().from(sectionShareLink).where(and(eq(token), isNull(revokedAt))).limit(1)` → `row??null`（镜像 getShareByToken:85-92）。
  - `getSectionScheduleForShare(tenantId, sectionId, window=feedWindow())`：`sectionIds=[sectionId]`（跳过 enrollment），`db.select(...).from(lesson).where(and(eq(lesson.tenantId), eq(lesson.sectionId, sectionId)))`，`courseTitlesForSections` 拼名，`sliceLessonsForSections(withSectionTitles(rows, titles), [sectionId], window)`。
- **MIRROR**: getStudentScheduleForShare:98-138（去掉 enrollment 查询，sectionIds 直接给定）
- **GOTCHA**: P4-2 例外——此处用裸 `db`（非 forTenant），tenantId/sectionId **只来自 token 解析出的 share 行**，绝不来自请求参数；复用同一纯切片函数保证过滤一致。
- **VALIDATE**: `tests/section-share-slicing.test.ts` 覆盖窗口/取消/排序（可直接改造 share-slicing.test.ts）。

### Task 2.6: 公开页 `/sec/[token]`
- **ACTION**: 创建 `src/app/sec/[token]/page.tsx` + `not-found.tsx`
- **IMPLEMENT**: 镜像 `s/[token]/page.tsx`：`export const dynamic='force-dynamic'`、`metadata.robots noindex`；`getSectionShareByToken(token)` → 无则 `notFound()`；用 `share.tenantId+share.sectionId` 直查 classSection+course 取班级名 → `getSectionScheduleForShare(...)` → `<ScheduleCard data={{ studentName: 班级显示名, lessons }} />`。not-found.tsx 照抄含糊 404。
- **MIRROR**: s/[token]/page.tsx（全文）、not-found.tsx
- **GOTCHA**: 位于 `dashboard/` 之外无 auth layout；坏/撤销 token → `notFound()` 绝不重定向登录。`ScheduleCard` 硬编码"{studentName} 的课表"——把班级名（"课程名 · 班级名"）传入 `studentName` 即得"XX班 的课表"；如需精确"班级课表"字样，可给 ScheduleCard 加可选 title prop（可选小改，非必须）。
- **VALIDATE**: 无痕窗口打开链接看到整班课表；撤销后 404。

### Task 2.7: next.config noindex + 挂载 UI
- **ACTION**: 编辑 `next.config.ts`（加 `/sec/:token*` 的 X-Robots-Tag，镜像 :24-25）；创建 `src/app/dashboard/teach/[sectionId]/section-share-panel.tsx`（client，镜像 students/export-panel.tsx 的生成/复制/重新生成/停用）；编辑 `tabs/export-panel.tsx` 挂载它（server 先 `getActiveSectionShare` 拿 token，传 `token`/`sectionId`/`shareOrigin={env.NEXT_PUBLIC_APP_URL}`）。
- **MIRROR**: next.config.ts:21-26；students/export-panel.tsx（全文）；students-tab.tsx:22,69-73（server 侧取 token 传给 client）
- **IMPORTS**: `env` from `@/env`；分享 action（Task 2.4）
- **GOTCHA**: B30——client `startTransition` 内每个 `await` 必须 `try/catch` 落 `setError`；URL 拼 `${shareOrigin}/sec/${token}`。
- **VALIDATE**: 导出 tab 出现分享块；`curl -I /sec/<token>` 含 `X-Robots-Tag: noindex`。

---

## Testing Strategy

### Unit / Integration Tests
| Test | 类型 | Input | Expected | Edge? |
|---|---|---|---|---|
| `format-datetime.test.ts` | 纯 | Date / ISO string / null | 'yyyy-MM-dd HH:mm' / 同 / '—' | ✅ null |
| `teach-attendance.test.ts` | DB | upsert 出勤后加载 | LessonNoteRow.attendance 含状态 | ✅ 无记录课节 |
| `section-share-slicing.test.ts` | 纯 | fabricated section lessons | 窗口/取消/排序过滤正确 | ✅ 空 section |
| `portal-report-scope.test.ts` | DB | 家长 A、孩子 X/Y，含 draft+approved | 只见 X/Y 的 approved | ✅ 别家孩子被排除、draft 被排除 |
| RBAC 断言（并入现有 rbac 测试或新建） | 纯 | `can('parent',{report:['read']})` | true；approve → false | ✅ |

### Edge Cases Checklist
- [ ] 多孩家长（cards.length>1）显示筛选；单孩/学生不显示
- [ ] 家长无关联孩子（portalLink 空）→ 课表/报告页显示空态，不报 `inArray([])`
- [ ] 撤销的 section 分享 token → `/sec/<token>` 404
- [ ] 出勤在无 note 记录的课节也能标记（initial.attendance 默认 `{}`）
- [ ] 报告 `sectionId=null`（跨全程）在课程筛选中的归类
- [ ] 时间戳为 null（理论上不会，字段 notNull）→ helper 返回 '—'
- [ ] 跨租户隔离：所有读写走 `forTenant`；公开页只用 token 解析出的 tenantId
- [ ] 权限：parent 只能 read/list report，不能 approve

---

## Validation Commands

### Static Analysis
```bash
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint .
```
EXPECT: 零类型/lint 错误

### Unit Tests
```bash
pnpm test         # vitest run —— 见 worktree 跑测须知（记忆：symlink 主检出 node_modules+.env，DB :5433）
```
EXPECT: 新增测试全绿，无回归

### Database Validation（仅功能2）
```bash
pnpm db:generate  # 产出 drizzle/0017_*.sql
pnpm db:migrate   # tsx scripts/migrate.ts（DATABASE_URL 指向 :5433）
```
EXPECT: 迁移只含新表 + 索引；migrate 成功

### Browser Validation
```bash
pnpm dev          # next dev
```
EXPECT: 逐功能手测（见下）

### Manual Validation
- [ ] 功能1：工作台展开课节→标出勤→刷新仍在→一键保存
- [ ] 功能2：班级导出 tab 生成链接→无痕打开看整班课表→停用后 404
- [ ] 功能3：用户行/班级设置显示创建+修改时间（时区 America/Toronto）
- [ ] 功能4：家长（多孩）登录→标题"课表"+筛选；学生登录→无筛选
- [ ] 功能5：家长→进度报告→双筛选→只见 approved

---

## Acceptance Criteria
- [ ] 5 项功能全部实现并手测通过
- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm test` 全绿
- [ ] 功能2 迁移生成且可 migrate；双 lockfile 无需改（无依赖变更）
- [ ] 所有租户表读写走 `forTenant`；公开页只信任 token 解析出的 tenantId
- [ ] 家长只见自己孩子的 approved 报告（行级 scope 有测试）
- [ ] 符合 UX 设计（文案/筛选/日期展示）

## Completion Checklist
- [ ] 代码遵循发现的模式（Server Action 四段式 / 门户边界 toPortalActionError）
- [ ] 错误处理区分员工边界（throw）与门户边界（toPortalActionError）
- [ ] 日期格式统一走 `formatDateTime` + APP_TIME_ZONE
- [ ] 测试遵循 vitest 纯/DB 两种模板
- [ ] 无硬编码时区/URL（用 APP_TIME_ZONE / env.NEXT_PUBLIC_APP_URL）
- [ ] 无越权 verb（parent report 仅 read/list）
- [ ] 无多余 scope（PDF 门户下载列为后续）

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| 复用 `upsertAttendance` 只 revalidate schedule，teach 不刷新 | 高 | 中 | 客户端 `router.refresh()`（已是惯例）或建薄 wrapper revalidate teach |
| `ScheduleCard` 文案"…的课表"不适配班级 | 中 | 低 | 班级名传入 studentName；或加可选 title prop |
| parent 加 report 权限被误用到写路径 | 低 | 高 | 仅加 read/list；数据层 `resolveLinkedStudentIds` 行级 scope + 测试 |
| 公开 `/sec/` 泄露/被索引 | 中 | 中 | X-Robots-Tag noindex + token nanoid(32) + 软撤销立即 404 |
| worktree 跑 vitest 需 DB/env | 高 | 低 | symlink 主检出 node_modules+.env，DB :5433（见记忆 [[review-blocking-fix-progress]]） |
| `actorOwnsSection` 签名（取 id vs 对象）不确定 | 中 | 低 | 实现前读 `src/auth/scope.ts` 确认；必要时先 findById |

## Notes
- **实现顺序建议**：3（零风险）→ 1（复用后端）→ 4（文案+筛选）→ 5（新页+放权）→ 2（新表+迁移）。可拆 5 个 PR。
- **关键复用**：功能1 出勤后端、功能2 学生分享全套、功能4/5 的 `resolveLinkedStudentIds` 都已存在——本计划大量是"接线"而非"造轮子"。
- **RBAC 唯一变更**：功能5 给 parent/student 加 `report:['read','list']`（permissions.ts）。其余功能不动权限矩阵。
- **无 schema 变更**的功能：1、3、4、5；**唯一新表**：功能2 的 `section_share_link`。
- 相关记忆：[[account-rbac-admin-seed-status]]、[[review-blocking-fix-progress]]、[[app-timezone-toronto]]、[[dual-lockfile-npm-pnpm]]。
