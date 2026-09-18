# Implementation Report: 教务工作台与家长门户增强（5 项功能）

## Summary
按计划 `.claude/PRPs/plans/portal-and-workspace-features.plan.md` 实现 5 项功能，遵用户要求**按 3→1→4→5→2 拆分为 5 个独立草稿 PR**（各自基于 `main` 开分支）。每个功能由独立实现 agent 在隔离 git worktree 内完成、symlink 主检出依赖跑校验、提交推送并开 PR。全部 5 个功能：0 新增 tsc 错误、lint 干净、新增测试通过。

## Assessment vs Reality
| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large | Large（符合） |
| Confidence | 8/10 | 达成——大量为已有能力"接线"，偏差均为小幅正确适配 |
| Files Changed | ~30 | 38（新增 ~18 含迁移/快照，修改 ~13，测试 4） |
| PRs | 建议 5 个 | 5 个草稿 PR（#45–#49） |

## Tasks Completed
| # | 功能 | PR | 状态 | 备注 |
|---|---|---|---|---|
| 3 | 用户/班级创建·修改日期 | #45 | ✅ 完成 | 偏差：该 Drizzle 版本 user 时间戳推断为 Date（非 string），helper 两者兼容 |
| 1 | 工作台内联出勤 | #47 | ✅ 完成 | 复用 schedule `upsertAttendance` + 薄 wrapper；错误提示用既有 `useFlash.show()` 而非 setError |
| 4 | 门户课表文案+多孩筛选 | #46 | ✅ 完成 | `ScheduleCard` 为具名导出（GOTCHA 命中，已改 import） |
| 5 | 家长门户进度报告页 | #48 | ✅ 完成 | `forTenant` 单表 API → 分两次查 + `sectionDisplayName` 组装（不裸用 db） |
| 2 | 班级排课分享链接 | #49 | ✅ 完成 | 迁移 0017 生成，**未 apply 共享 DB**；归属守卫用既有 `actorOwnsSectionById` |

## Validation Results
| Level | Status | Notes |
|---|---|---|
| Static Analysis (typecheck) | ✅ Pass | 各 PR 均"0 新错"；仅 1 个**预存** web-push 错（主 node_modules 缺 web-push，与本次无关） |
| Lint | ✅ Pass | 各 PR 对改动文件 eslint 干净 |
| Unit / DB Tests | ✅ Pass | 功能1 `teach-attendance` 2 passed；功能5 `portal-report-scope` 2 passed；功能2 `section-share-slicing` 7 passed；功能3 `format-datetime` 3 passed |
| Build | ⚠️ 未跑 | Turbopack 拒绝 symlink node_modules；typecheck 已覆盖类型正确性 |
| Integration (E2E) | N/A | 未跑 Playwright；留待合并后手测/CI |
| DB Migration | ✅ 生成 | 功能2 `drizzle/0017_even_agent_brand.sql`（CREATE TABLE + 4 索引 + 1 复合 FK）；未 migrate 共享 DB，合并后需 `pnpm db:migrate` |

## Files Changed（按功能）
- **功能3 (PR#45)**：`src/lib/format-datetime.ts`(new)、`src/app/dashboard/users/data.ts`、`.../users/{teachers,admins,parents,students}-tab.tsx`、`.../teach/[sectionId]/tabs/settings-panel.tsx`、`tests/format-datetime.test.ts`(new)
- **功能1 (PR#47)**：`.../teach/[sectionId]/data.ts`、`.../attendance-actions.ts`(new)、`.../lesson-notes-inline.tsx`、`.../section-lessons.tsx`、`tests/teach-attendance.test.ts`(new)
- **功能4 (PR#46)**：`src/app/portal/schedule-cards.tsx`(new)、`.../portal/page.tsx`、`.../portal/layout.tsx`、`.../portal/data.ts`
- **功能5 (PR#48)**：`src/auth/permissions.ts`、`src/app/portal/reports/{data.ts,page.tsx,reports-list.tsx}`(new)、`.../portal/layout.tsx`、`tests/portal-report-scope.test.ts`(new)
- **功能2 (PR#49)**：`src/db/schema/section-share-link.ts`(new)、`.../schema/{index,relations}.ts`、`src/lib/share.ts`、`.../teach/[sectionId]/{section-share-data.ts,section-share-actions.ts,section-share-panel.tsx}`(new)、`.../tabs/export-panel.tsx`、`src/app/sec/[token]/{page.tsx,not-found.tsx}`(new)、`next.config.ts`、`drizzle/0017_*.sql`+meta、`tests/section-share-slicing.test.ts`(new)

## Deviations from Plan
1. **功能3**：user 时间戳类型是 `Date` 非 `string`（Drizzle 推断），`StaffRow/PortalUserRow` 字段标 `Date`；helper 仍兼容两者。
2. **功能4**：`ScheduleCard` 具名导出，import 调整。
3. **功能1**：客户端错误提示复用组件既有 `useFlash.show()`（无 setError）；测试用 `vi.mock('@/auth/context')` 驱动 wrapper 而非直接 db 写。
4. **功能5**：`forTenant` 无 join → 分两次查 classSection→course 再 `sectionDisplayName` 组装；`periodStart/End` date 用 `.toISOString().slice(0,10)` 过 RSC→client 边界；section 筛选 null 用空串 bucket 标"全程"。
5. **功能2**：归属守卫用既有 `actorOwnsSectionById(ctx, sectionId)`（自带加载）；`ScheduleCard` 无 section prop，班级显示名传入 `studentName`（依计划 note）。

## Issues Encountered
- **预存 web-push 缺失**：主 node_modules 缺 `web-push`，导致 typecheck 有 1 个固定错误、部分 vitest suite 加载失败。各 agent 正确识别为基线噪音，新增测试均不 import push 模块故可独立跑通。
- **主检出一度被误写**（功能3 agent）：因用了主检出绝对路径，Edit 落到 main；agent 在提交前发现并回滚，主检出确认干净。后续 4 个 agent 强化"仅 worktree 相对路径"约束，无复发。核验：`git status` 主检出干净。

## Tests Written
| Test File | Tests | Coverage |
|---|---|---|
| `tests/format-datetime.test.ts` | 3 | Date/ISO string/null 格式化 |
| `tests/teach-attendance.test.ts` | 2 | 出勤 upsert + 批量加载入 LessonNoteRow |
| `tests/portal-report-scope.test.ts` | 2 | 家长只见自己孩子的 approved 报告 |
| `tests/section-share-slicing.test.ts` | 7 | 公开班级课表切片（窗口/取消/排序/空 section） |

## Next Steps
- [ ] 逐 PR `/code-review`（重点：功能2 租户隔离/公开页 token 作用域、功能5 行级 scope + RBAC）
- [ ] 合并顺序：功能2 合并后须 `pnpm db:migrate` 应用 0017 到各环境
- [ ] 功能4 与功能5 都改了 `portal/layout.tsx`，第二个合并者需解决导航行的小冲突
- [ ] 合并后手测 5 项功能（见计划 Manual Validation）；跑 E2E 基线
