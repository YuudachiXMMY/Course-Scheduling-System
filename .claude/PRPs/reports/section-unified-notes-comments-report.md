# Implementation Report: 班级工作台「排课」Tab 内统一管理每节课笔记/点评/成绩

## Summary
在 `/dashboard/teach/[sectionId]` 的「排课」tab 里,为每个课节行新增**行内展开**的笔记编辑区:一屏内批量编辑本节课全班共享笔记(Summary)、每个在读学生的点评(per-student note),以及可选的课堂成绩(grade)。复用已有的 `note` 表与 `upsertSharedNote`/`upsertStudentNote` server actions,新增一个每(课节, 学生)的轻量成绩 upsert。**无数据库迁移**(note、grade 表已具备全部所需列)。

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium | Medium(与预期一致) |
| Confidence | 9/10 | 代码层 9/10;E2E 执行受运行时环境阻塞 |
| Files Changed | 新增 2 + 修改 3 + 2 测试 = 7 | 新增 3 + 修改 3 + 1 单测 + 1 E2E = 与预期一致(见下) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | data.ts 加常量 + 批量加载器 + 成绩 core | ✅ 完成 | 偏差:按 Task 6 GOTCHA 的建议,把成绩写逻辑拆为可测的 `upsertLessonStudentGradeCore(ctx, data)` 放在 data.ts(镜像 report-core) |
| 2 | grade-actions.ts(选填成绩 upsert) | ✅ 完成 | 薄 `'use server'` 壳:requireAuthContext → requirePermission → zod → core → revalidatePath |
| 3 | lesson-notes-inline.tsx 客户端行内编辑器 | ✅ 完成 | 镜像 LessonDetail 的受控 state + useTransition + useFlash |
| 4 | lessons-panel.tsx 加载 roster + notes 矩阵 | ✅ 完成 | Promise.all(lessons, roster) → 再 await notes 矩阵 |
| 5 | section-lessons.tsx 展开开关 + 渲染编辑器 | ✅ 完成 | 每行新增「笔记点评 ▼/▲」开关,与整行点击打开抽屉互补 |
| 6 | tests/section-notes.test.ts 单测 | ✅ 完成 | 5 个 DB 集成用例全绿 |
| 7 | tests/e2e/dashboard/teach-notes.spec.ts | ⚠️ 已编写,执行受阻 | type/lint 通过;运行时命中**预先运行的 OrbStack 容器旧构建**,详见下 |
| 8 | 全量校验 | ✅ 完成 | typecheck / lint / vitest(114)/ db:generate 全部通过 |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis (typecheck) | ✅ Pass | `tsc --noEmit` 零错误 |
| Static Analysis (lint) | ✅ Pass | `eslint .` 零错误 |
| Unit Tests | ✅ Pass | 新增 5 用例;全量 17 文件 / 114 用例全绿,无回归 |
| Build (db:generate) | ✅ Pass | "No schema changes, nothing to migrate" —— 零新迁移,符合验收项 |
| Integration (E2E) | ⚠️ Blocked (非代码缺陷) | 见「Issues Encountered」 |
| Edge Cases | ✅ Pass(单测覆盖) | 空 roster / 空 lessonIds / 成绩三项空删除 / latest-wins / 成绩 title 过滤 / 租户隔离 |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `src/app/dashboard/teach/[sectionId]/data.ts` | UPDATED | +~110 |
| `src/app/dashboard/teach/[sectionId]/grade-actions.ts` | CREATED | +30 |
| `src/app/dashboard/teach/[sectionId]/lesson-notes-inline.tsx` | CREATED | +190 |
| `src/app/dashboard/teach/[sectionId]/tabs/lessons-panel.tsx` | UPDATED | +18 / -8 |
| `src/app/dashboard/teach/[sectionId]/section-lessons.tsx` | UPDATED | +30 / -8 |
| `tests/section-notes.test.ts` | CREATED | +215 |
| `tests/e2e/dashboard/teach-notes.spec.ts` | CREATED | +48 |

## Deviations from Plan
- **成绩逻辑拆分为 core**:计划 Task 2 把全部逻辑写在 action 内;Task 6 的 GOTCHA 已预告需拆分以便单测。实现采用拆分版:`upsertLessonStudentGradeCore(ctx, data)` 放在 `data.ts`(server-only、接 ctx、无 auth/revalidate),`grade-actions.ts` 只做 auth+zod+revalidate 后转调 core。这与 `report-core.ts` / `reports/actions.ts` 的分层完全一致,单测得以直接测 core。
- **成绩单元格只暴露 分数 / 满分,不暴露 grade.comment 输入框**:用户澄清「comment 指已有的点评数据,只需额外追加成绩」,因此点评(note)承担评语职责,成绩格仅 `[分数]/[满分]`,避免与点评框重复的第二个评语框。`grade.comment` 仍由 schema/core 支持(留作 API/未来用),只是不在 UI 呈现。

## Issues Encountered
- **E2E 执行受阻于陈旧运行时(非代码问题)**:`http://localhost:3000` 由 **OrbStack 容器**(PID 1510)提供,运行的是我改动之前构建的镜像。Playwright `reuseExistingServer: true` 复用了它,因此页面渲染的是旧代码 —— 失败快照显示每个课节行只有「改期」按钮、缺少新增的「笔记点评」按钮(正是改动前的 DOM 结构)。这证明:
  - globalSetup 播种成功(section A 16 节课、导航、roster 均正常渲染);
  - 失败**仅因新按钮尚未部署到该容器**,而非选择器或逻辑错误。
- **如何跑通 E2E**:重建/重启承载 `:3000` 的容器(使其包含当前代码),或停掉该容器让 Playwright 自行以当前工作树启动 `npm run dev`,然后:
  ```bash
  npm run test:e2e -- tests/e2e/dashboard/teach-notes.spec.ts
  ```
  未擅自重启用户正在运行的 OrbStack 技术栈(对外/破坏性操作,后台任务不主动执行)。

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `tests/section-notes.test.ts` | 5 | 矩阵分组 / latest-wins / 成绩 title 过滤 / grade upsert-update-delete / 租户隔离 / 空 lessonIds |
| `tests/e2e/dashboard/teach-notes.spec.ts` | 1 | 展开课节 → 保存 Summary / 点评 / 成绩 → 断言成功提示(待在新构建上运行) |

## Next Steps
- [ ] 在包含当前代码的运行时上执行 E2E(重建 `:3000` 容器或改用本地 `npm run dev`)
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
