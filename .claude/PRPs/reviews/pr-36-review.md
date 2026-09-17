# PR Review: #36 — feat(rbac): 教师本班收敛 — 数据作用域限制到本人 section（计划 PR-3 / 工作流 E）

**Reviewed**: 2026-09-17
**Author**: Jadyn Wu (YuudachiXMMY)
**Branch**: worktree-feat-account-rbac-teacher-scope → main
**Decision**: COMMENT（draft PR；无 Critical / 无可利用 High，2 Medium + 3 Low，均为纵深防御 / 测试完备性建议，不阻断）

## Summary

在租户隔离之上为普通 `teacher` 叠加行级数据作用域，设计正确、中心化收敛（`listSections`/`listStudents` 一处收敛，调用点自动继承），并新增 `getSectionHeader` 归属守卫闭合了 URL 越权直访他班工作台的漏洞。核心作用域逻辑（`sectionIdsForActor`/`studentIdsForActor`/`actorOwnsSection`）实现干净、有 DB 集成测试。主要改进空间在于:(1) 分段读取加载器不做独立归属校验、完全依赖 layout 收口——在**魔改版 Next.js** 上这层假设值得加固;(2) security PR 的最高风险行为(URL 越权守卫、收敛、花名册写守卫)缺少集成测试锁定。

## Findings

### CRITICAL
None.

### HIGH
None（无本 PR 引入的可利用高危;下方 LOW#1 的写路径越权为 pre-existing 且 PR 已显式声明 out-of-scope）。

### MEDIUM

**M1 — 分段读取加载器无独立归属守卫,完全依赖 layout 单一收口（纵深防御 + 魔改 Next.js 的残余不确定性）**
`src/app/dashboard/teach/[sectionId]/data.ts` 的 `getSectionRoster` / `getSectionLessons` / `getSectionReports` / `getSectionPendingRescheduleCount` / `getSectionLessonNotes` 均不做 `actorOwnsSection` 校验。`lessons-panel.tsx` 与 `reports-panel.tsx` 也**不**复调 `getSectionHeader`,完全依赖 `teach/[sectionId]/layout.tsx:20` 的 `getSectionHeader` 收口。

- 在**标准 Next.js 语义**下无客户端泄露:layout 是 async server component,`await getSectionHeader` 抛 `notFound()` 时 shell 未产出任何输出,children(page/panels)即使并行执行了 DB 查询也无法 flush 到客户端,最终呈现 not-found 页 → **确认当前无泄露**。
- 但值得加固:(a) AGENTS.md 明确警告这是"魔改/breaking 版 Next.js",layout↔children 的渲染/流式顺序可能与上游不同,而本 PR 的整个越权防线正押在这条渲染时序语义上;(b) 防御**不对称**——`students-panel`/`settings-panel` 会各自复调 `getSectionHeader` 守卫,而承载主要内容的 `lessons-panel`/`reports-panel` 不会;(c) 这些加载器是可独立调用的 ownership-agnostic 函数,未来任何绕过该 layout 的新调用点会立即从"无泄露"变成"真实泄露"。
- **建议**:在 `getSectionRoster` / `getSectionLessons` / `getSectionReports` 内各加一次 `actorOwnsSection` 断言(`getSectionLessons` 已加载 section 行,零额外查询;`getSectionRoster` 需补一次 `findById(classSection, id)`),把归属校验下沉到数据层而非只在 layout 一处。或**至少**补一条集成测试锁定 layout 收口行为(见 M2)。
- 位置:`src/app/dashboard/teach/[sectionId]/data.ts:62,81,133,155,200`;`tabs/lessons-panel.tsx`、`tabs/reports-panel.tsx`。

**M2 — 安全 PR 的最高风险行为缺少集成测试覆盖**
`tests/rbac-teacher-scope.test.ts` 只覆盖 `sectionIdsForActor`/`studentIdsForActor`/`actorOwnsSection` 的纯逻辑 / DB 层,**没有**断言真正的防线行为:
- `getSectionHeader(ctx, 他班id)` 对普通教师抛 `notFound()`(唯一挡住 URL 越权的机制,却无回归测试)。
- `listSections()`/`listStudents()` 在教师 ctx 下确实收敛到本班。
- `enrollStudent`/`unenrollStudent`/`listSectionEnrollments` 的写路径归属守卫拒绝他班 sectionId。
- **建议**:补 3–4 条集成测试(可复用现有 seed):教师 ctx 调 `getSectionHeader` 他班 id → 断言 throw;三个 enrollment action 携他班 sectionId → 断言拒绝 / 空结果。这是本 PR 声称价值的核心,应有测试兜底。

### LOW

**L1 — grade/note 写路径无 section 归属守卫（pre-existing,PR 已文档化为后续）**
`teach/[sectionId]/grade-actions.ts` → `upsertLessonStudentGradeCore(ctx, {lessonId, studentId, ...})` 仅做 `requirePermission(lesson:update)` + zod,**不校验该 lesson 是否属于本教师的 section**。教师携猜测的他班 `lessonId` 直接构造该 action 调用可**写**他班成绩/点评(attendance/note 写路径同理)。属 PR body 中"lesson/materialize/reschedule 更广写路径授权审计留作后续"同类,`grade-actions.ts` 未在本 PR 改动范围。利用前提:已知有效他班 `lessonId`(教师无法从收敛后的 UI 发现)。**建议**:尽快把该专项写路径授权审计提为独立 follow-up——写越权比读越权影响更实。

**L2 — 花名册选择器语义变更(教师无法新增未入册学生)**
教师的 `listStudents` 现只返回本班 active 学生 → section 花名册选择器不再列出"尚未在本教师任何班中"的学生,教师实际无法通过选择器新增学生入册。PR body 已披露,系 2026-09-16"教师只见本班"产品决策的直接推论(新学生入册为管理员职能),**非 bug**,确认即可。

**L3 — 工作树存在未提交的格式化漂移**
`src/app/dashboard/schedule/enrollment-actions.ts` 有一处未提交的 prettier 格式化改动(多行 union type 折成单行,语义完全相同),PR head(0ea3914)不含它。不影响 PR 内容,但工作树非全净。建议提交或 `git checkout` 还原,避免与 PR 内容混淆。

## 正确性确认（无回归）
- drizzle `and(a, b, undefined)` 与 `and(a, b)` 序列化一致 → `'all'` 路径 SQL 与改动前逐字节相同,owner/admin/assistant/superadmin **零回归**。已在多处 `scope === 'all' ? undefined : inArray(...)` 使用。
- 所有 `inArray(col, scope)` 调用点均在 `scope.length === 0` 短路之后 → 无 `inArray([])` 非法 SQL。
- 多角色边界:`teacher,assistant` → `hasWholeTenantRole` true → 见全租户(assistant 设计上即租户级助手,符合预期);`parent`/`student`/空角色 → `[]`(见不到任何),防御性正确。
- `listLessonsInRange` 批量加载的 section/course/enrollment/student 均派生自已收敛的 lesson.sectionId → 无二次泄露。

## Validation Results

| Check | Result | Notes |
|---|---|---|
| Type check | Pass | 本次 review 重跑 `tsc --noEmit`,0 错误 |
| Lint | Pass | 本次 review 重跑 `eslint .`,0 警告 |
| Tests | Pass（继承） | 提交时 145 passed(含新增 6 例 DB 集成);工作树自提交起功能等价(仅 L3 格式化漂移),未重跑 |
| Build | Pass（继承） | 提交时 `next build` 成功(worktree 需先 `npm ci` 装真实 node_modules,Turbopack 拒软链) |

## Files Reviewed

| File | Change |
|---|---|
| `src/auth/scope.ts` | Added（作用域原语） |
| `src/auth/roles.ts` | Modified（分类助手） |
| `src/app/dashboard/courses/actions.ts` | Modified（`listSections` 收敛） |
| `src/app/dashboard/students/actions.ts` | Modified（`listStudents` 收敛） |
| `src/app/dashboard/schedule/data.ts` | Modified（`listLessonsInRange` 收敛） |
| `src/app/dashboard/schedule/page.tsx` | Modified（复用收敛后的 `listSections`） |
| `src/app/dashboard/reports/data.ts` | Modified（`getReportsPageData` 收敛） |
| `src/app/dashboard/reports/actions.ts` | Modified（`listReports` 防御性收敛，dead code） |
| `src/app/dashboard/schedule/enrollment-actions.ts` | Modified（花名册写路径归属守卫） |
| `src/app/dashboard/teach/[sectionId]/data.ts` | Modified（`getSectionHeader` 归属守卫） |
| `tests/rbac-teacher-scope.test.ts` | Added（6 例 DB 集成测试） |

---

## 修复记录（2026-09-17，随后追加提交）

在 `solve medium` 修复过程中,对最终 diff 做了**对抗式独立核验**(3 视角并行:可绕过性 / 回归 / 测试有效性),核验确认 M1 的 `requireOwnedSection` 正确且无绕过、无回归,但**发现了两处此前未覆盖的同类高危路径**(与本 feature 同源、由 teach export-panel 直接链接的 API 路由,绕过 RSC layout 守卫),已一并闭合。

### M1 — 已解决
新增 `requireOwnedSection(ctx, id)` 数据层守卫(findById + `actorOwnsSection` + `notFound()`,返回 section 复用),下沉进 `getSectionHeader` / `getSectionRoster` / `getSectionLessons` / `getSectionPendingRescheduleCount`;`getSectionReports` 加**显式自守卫**(不再仅靠 `getSectionRoster` 传递);`getSectionLessonNotes` 按 lessonIds、下游于已守卫的 `getSectionLessons`,补注释。归属校验不再仅依赖 layout 单一收口,直调加载器也 404。

### 🔴 新发现并修复的两处 HIGH（对抗式核验产出,超出原 M1/M2 范围）
- **`GET /api/reports/section/[sectionId]/route.ts`** — 仅 `report:['read']` + 租户存在性检查,无 `actorOwnsSection`。普通教师(角色含 `report:read`)改 URL 里的 sectionId 即可下载他班学生的**已定稿报告 PDF**。**修复**:findById 后加 `if (!actorOwnsSection(ctx, section)) return 404`。
- **`GET /api/export/section/[sectionId]/route.ts`** — 仅 `student:['read'],lesson:['read']` + 租户存在性检查。教师可读他班花名册+课表(PNG/ICS),且第 66 行 `ensureActiveShare` 在 GET 上为他班学生**铸造持久公开分享 token**。**修复**:同样加 `actorOwnsSection` 404 守卫。
- 二者均返回 404(非 403)以不泄露 section 存在性;`owner/admin/assistant/superadmin` 经 `actorOwnsSection` 放行。

### M2 — 已解决（覆盖扩展至 12 例)
`tests/rbac-teacher-scope.test.ts` 由 6 例扩至 12 例:
- 数据层守卫:`getSectionHeader`/`getSectionRoster`/`getSectionLessons`/`getSectionReports`/`getSectionPendingRescheduleCount` — 本人 section 解析、猜他班 id → `NEXT_NOT_FOUND`、owner+超管放行(seed 一节课使 lessons 正向断言非空)。
- **写路径守卫**(lens-3 标记的最高风险未覆盖面):`enrollStudent`/`unenrollStudent` 对他班 → `无权管理该班级`;`listSectionEnrollments` 他班 → `[]`、本班 → 真实花名册。经 `vi.mock('@/auth/context')`(`importActual` 保留 `AuthError`,仅覆盖 `requireAuthContext`)驱动 'use server' action。
- `next/navigation`/`next/cache` 以确定性 mock 解耦魔改 Next 运行时。

### 未修复(明确文档化为后续)
- **API 路由缺 handler 级测试**:两个 route 因导入重型 puppeteer/PDF 依赖(`renderCardPng`/`renderReportPdf`),在 vitest 单测里加载不现实;守卫复用的 `actorOwnsSection` 已单测,与本仓库「测数据层、不测 route handler」惯例一致。
- **`getSectionLessonNotes` 同租户他班**:该加载器按 lessonIds、结构上无法在本层校验 section 归属,安全性依赖调用方 `lessons-panel` 从已守卫的 `getSectionLessons` 取 lessonIds(注释锁定,未加测试)。
- **grade/note 写路径**(原 L1)、`lesson/materialize/reschedule` 更广写路径授权审计仍作专项 follow-up。

### 验证(修复后重跑)
typecheck 0 · lint 0 · **151 tests 全绿**(22 文件,+6 新增)· `next build` 成功。
