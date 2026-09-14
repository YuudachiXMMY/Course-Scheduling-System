# Implementation Report: Phase 5 — Progress Reports（学生进度报告）

## Summary
实现了学生 PDF 进度报告的完整闭环：Claude 起草叙述（server-only 单次调用，版本化 rubric 缓存，明确“不得编造事实”）→ 教师在报告仪表盘编辑/审核 → `draft → approved` 门禁定稿 → 导出 PDF（单份 inline + 小班批量 ZIP）。出勤/成绩等数字**全部从数据库直渲**进 PDF，Claude 只写叙述。中文用**内嵌 Noto Sans SC .ttf** + `@react-pdf/renderer` 免 Chromium 渲染。

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large | Large — 准确 |
| Confidence | 8/10 | 单遍完成，无阻塞；最高风险（CJK PDF 字体）经真实渲染 smoke 测试验证通过 |
| Files Changed | ~18（13 新 / 5 改） | 24（19 新 / 5 改 + 2 迁移产物 + 字体）|

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | report_status enum | ✅ Complete | |
| 2 | progressReport 表 | ✅ Complete | 组合 FK（student restrict / section set null）+ 4 index |
| 3 | 导出 + 迁移 | ✅ Complete | `drizzle/0004_broken_cyclops.sql`（drizzle-kit 生成）|
| 4 | report RBAC + 六角色矩阵 | ✅ Complete | owner/admin/teacher 全权含 approve；assistant read/list；parent/student 无 |
| 5 | Anthropic env（optional）| ✅ Complete | `ANTHROPIC_API_KEY` optional + `ANTHROPIC_MODEL` 默认 claude-opus-4-8 |
| 6 | report-data 聚合 | ✅ Complete | 拆出纯 `report-stats.ts`（偏离，见下）便于无 DB 单测 |
| 7 | report-prompt 纯 composer + rubric | ✅ Complete | v1 rubric 含防幻觉指令 |
| 8 | report-draft Claude 调用 | ✅ Complete | 缓存 rubric、无 temperature/budget_tokens、缺 key fail-fast |
| 9 | report-pdf + 内嵌 Noto Sans SC | ✅ Complete | 18MB 可变字体 TTF；真实渲染 smoke 通过 |
| 10 | report server actions | ✅ Complete | 拆出 `report-core.ts`（偏离）作可测核心，actions 薄封装 |
| 11 | 报告仪表盘 UI + 导航 | ✅ Complete | RSC page + client panel + 生成/编辑/批准/下载 |
| — | 路由 | ✅ Complete | `/api/reports/[reportId]/pdf`（单份）+ `/api/reports/section/[sectionId]`（ZIP）|
| 12 | 测试 | ✅ Complete | 拆成 2 文件（偏离）：`report.test.ts`（纯+PDF+mock，本地可跑）/ `report-db.test.ts`（CI/Postgres）|

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | ✅ Pass | `tsc --noEmit` + `eslint .` 全绿 |
| Unit Tests | ✅ Pass | `report.test.ts` 13/13（含真实 PDF 渲染 smoke，证明 CJK 不豆腐）|
| Build | ✅ Pass | `next build` 编译 + TS 通过；三条新路由 + `/dashboard/reports` 全部注册 |
| Integration | ✅ Covered | PDF 渲染路径经真实 `renderToBuffer` 验证；DB 生命周期测试（draft→approve→lock、租户隔离）已写，CI/Postgres 执行 |
| Edge Cases | ✅ Pass | 空出勤/空成绩/null 分数解析/缺 key/approved 锁定/跨租户 均有断言 |

## Files Changed

| File | Action | Notes |
|---|---|---|
| `src/db/schema/enums.ts` | UPDATED | +report_status |
| `src/db/schema/progress-report.ts` | CREATED | 进度报告表 |
| `src/db/schema/index.ts` | UPDATED | 导出新表 |
| `drizzle/0004_broken_cyclops.sql` (+meta) | CREATED | 迁移（生成）|
| `src/auth/permissions.ts` | UPDATED | report statement + 角色矩阵 |
| `src/env.ts` | UPDATED | ANTHROPIC_API_KEY / ANTHROPIC_MODEL |
| `public/fonts/NotoSansSC-Regular.ttf` | CREATED | 内嵌 CJK 字体（18MB）|
| `src/lib/report-stats.ts` | CREATED | 纯聚合/类型（无 DB）|
| `src/lib/report-data.ts` | CREATED | forTenant 聚合 |
| `src/lib/report-prompt.ts` | CREATED | 纯 composer + rubric |
| `src/lib/report-draft.ts` | CREATED | Claude 直调 |
| `src/lib/report-pdf.tsx` | CREATED | react-pdf 渲染 |
| `src/lib/report-core.ts` | CREATED | 报告变更核心（门禁）|
| `src/app/dashboard/reports/{actions,data}.ts` | CREATED | actions + 读数据 |
| `src/app/dashboard/reports/{page,report-panel}.tsx` | CREATED | UI |
| `src/app/api/reports/[reportId]/pdf/route.ts` | CREATED | 单份 PDF |
| `src/app/api/reports/section/[sectionId]/route.ts` | CREATED | 批量 ZIP |
| `src/app/dashboard/layout.tsx` | UPDATED | 导航“报告” |
| `package.json` / `package-lock.json` / `pnpm-lock.yaml` | UPDATED | +@anthropic-ai/sdk +@react-pdf/renderer（两锁文件同步）|
| `tests/report.test.ts` / `tests/report-db.test.ts` | CREATED | 测试 |

## Deviations from Plan
1. **拆出 `report-stats.ts`（纯）与 `report-core.ts`（变更核心）**：计划把纯聚合放在 report-data.ts、门禁放在 actions.ts。实际拆分——因为 (a) report-data.ts 顶层 import `@/db` 会拉入 env，使纯聚合无法在无 Postgres 的本地单测；(b) actions 依赖 Next session/headers，无法用 ctxFor 直测门禁。拆分后 `report-stats` 纯可测、`report-core` 可用 ctxFor 直测（mirror schedule-core），架构更贴合仓库既有分层。report-data 仍 `export *` 保持 API 兼容。
2. **测试拆成两文件**：计划单文件 `report.test.ts`。拆成 `report.test.ts`（纯+PDF+Claude-mock，本地可跑，无需 Postgres）与 `report-db.test.ts`（DB 集成，CI/Postgres），便于本地验证非 DB 部分并与既有 DB 测试对齐。
3. **字体为可变（variable）TTF**：从 google/fonts 取 `NotoSansSC[wght].ttf`（18MB 可变字体）。担心 react-pdf 对可变字体兼容，故先做真实 `renderToBuffer` smoke 测试——通过，CJK 正常嵌入渲染，风险消除。

## Issues Encountered
- **build/test 需要 DATABASE_URL**：`db/index.ts` 在模块求值时直接读 `process.env.DATABASE_URL` 并抛错（既有行为，非本次引入）。本地 build/test 用 dummy `DATABASE_URL`（不连接，仅通过校验）即可；CI 有真实 Postgres。已记录在验证命令中。
- **pnpm-lock 同步**：用 npm 装依赖后，用 `pnpm install --lockfile-only` 同步了 pnpm-lock.yaml（两锁文件都更新，避免 PR#4 那类 CI 失败）。

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `tests/report.test.ts` | 13 | 聚合(出勤率/numeric string/均分/空)、prompt 防幻觉、report RBAC 矩阵、真实 PDF 渲染(CJK)、Claude mock(组装+缺key) |
| `tests/report-db.test.ts` | 4 | getReportData 聚合、createDraft、编辑→批准→锁定、跨租户隔离（CI/Postgres）|

## Next Steps
- [ ] Code review via `/code-review`
- [ ] 上线前用真实中文学生名逐面核对 PDF（数字 vs DB、无豆腐）
- [ ] 配置生产 `ANTHROPIC_API_KEY`（可选调 `ANTHROPIC_MODEL` 降本）
- [ ] CI 跑 `tests/report-db.test.ts`（需 Postgres）
