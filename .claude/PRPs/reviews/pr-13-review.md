# PR Review: #13 — feat(scheduling): 课程/班级编辑 + 选课 + 多时段 + 排课日历增强（8 项需求）

**Reviewed**: 2026-09-15
**Author**: Jadyn Wu (YuudachiXMMY)
**Branch**: worktree-prp-plan-scheduling-fixes → main
**Decision**: COMMENT（draft PR）— 含 2 项 HIGH，建议合并前修复

## Summary
实现质量整体高：租户边界（`forTenant` spine）、权限校验（`requireAuthContext` + `requirePermission`）、validation-as-data（防 React #441）、多时段子表设计、批量 join 免 N+1 均落实到位，typecheck 通过。但**编辑班级**这条新路径引入两个 HIGH 级正确性问题：编辑会静默改写 `teacherId`，且重新物化会残留旧课节。二者都源于"把原本只用于创建的流程复用到编辑"。

## Findings

### CRITICAL
None

### HIGH

**H1 — 编辑班级会把 `teacherId` 静默改写为当前登录用户**
`src/app/dashboard/courses/section-form.tsx:110` 提交时恒定 `teacherId: defaultTeacherId`，而 `page.tsx:54` 对创建和编辑两处 `SectionForm` 都传 `defaultTeacherId={ctx.userId}`。`updateSection`（`actions.ts:206` → `sectionRecurrenceColumns` 无条件写 `teacherId`）因此在编辑时用当前用户覆盖班级原有教师。
- 影响：多教师机构里，管理员/他人编辑某班级会把授课教师改成自己；且 `materializeSection` 用 `section.teacherId` 反规范化到 `lesson.teacherId`（`materialize.ts:100`），教师冲突检测与归属随之错乱。
- 表单无教师选择 UI，编辑态也未从 `section.teacherId` 预填。
- 建议：编辑态保留原 `teacherId`（`updateSection` 不覆盖，或表单回填 `section.teacherId` 并允许显式变更）。

**H2 — 编辑时段后重新物化会残留旧课节（脏数据）**
`section-form.tsx:133` 在 `updateSection` 后调用 `materializeSectionAction`。`materializeSection`（`materialize.ts:114-119`）只做 `INSERT ... ON CONFLICT DO NOTHING`，从不取消/删除旧排期的课节。改动时段（如 周一16:00 → 周一17:00 或删除一个 slot）后，新 `originalStartAt` 与旧的不同 → 旧课节保留、新课节新增，日历上出现重复/幽灵课节。
- 创建时只物化一次，本问题不存在；"班级可编辑 + 重新物化"是本 PR 新引入的组合。
- 已有 `cancelSeriesAction`（`schedule/actions.ts:93`）可取消未来未取消课节，但编辑流程未接线。
- 建议：编辑重新物化前，先取消该班级未来、未手工改动的自动课节（或按 `sectionId` 差量对账），再插入新排期。

### MEDIUM

**M1 — `replaceMeetings` 先删后插非原子（`actions.ts:146-164`）**
无事务包裹：删除旧 meeting 行后、插入新行前若失败，班级会残留 0/部分时段，而 lesson 可能已按旧数据物化，状态不一致。N 很小、概率低，但编辑路径下值得用事务或"插新后删旧"降低风险。

**M2 — `meetingUrl` / `location` 未做 URL 或协议校验（`schedule/actions.ts:53-57`、`courses/actions.ts:101`）**
仅限长度。当前 `meetingUrl` 只在日历渲染为"线上"文本、在抽屉作为 input value，无 `href`，暂无 XSS/开放重定向风险。但一旦后续渲染为可点击链接，`javascript:` 等协议会成为隐患。建议入库前校验为 `http(s)://` URL。

### LOW

- **L1** `createCourse`/`updateCourse` 仍用 `.parse()`（抛错，`actions.ts:37,51`），与本 PR 其他 action 的 result 模式不一致，依赖 `course-form.tsx:20` 客户端校验规避 React #441。schema 简单，风险低；为一致性可改 safeParse。
- **L2** `getLessonNotes`（`attendance-actions.ts:124` 取最新）与 `upsertSharedNote`（`:145` 更新 select 首行）在同一 lesson 存在多条 `studentId=null` 笔记时可能不一致。旧 `addNote` 已移除，仅影响历史脏数据。
- **L3** `section-form.tsx` 编辑态打开时，`meetings`/`capacity` 先渲染默认值再由 `listSectionMeetings` 异步覆盖，有一瞬默认值闪现；`capacity` 无异步回填但已由 `useState` 初值处理，仅 meetings 有闪现。次要 UX。

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint | Skipped（实现阶段已跑通，零错误） |
| Tests | Partial — 新增多时段纯逻辑测试 2 用例通过 + 64 纯逻辑测试通过；DB 依赖测试因无 Postgres 凭证未跑（环境限制） |
| Build | Skipped（实现阶段 `next build` 已通过） |

## Files Reviewed
- `src/db/schema/course.ts` (Modified) — sectionMeeting 表 + defaultMeetingUrl
- `src/db/schema/lesson.ts` (Modified) — meetingUrl 列
- `src/db/schema/relations.ts` (Modified)
- `drizzle/0007_bored_magus.sql` + `meta/*` (Added) — 迁移正确，FK 复合级联 + 索引齐备
- `src/lib/materialize.ts` (Modified) — 多时段展开 + 回退（见 H2）
- `src/app/dashboard/courses/actions.ts` (Modified) — 见 H1/M1/L1
- `src/app/dashboard/courses/section-form.tsx` (Modified) — 见 H1/H2/L3
- `src/app/dashboard/courses/course-form.tsx` (Modified) — 见 L1
- `src/app/dashboard/courses/section-roster.tsx` (Added) — 良好
- `src/app/dashboard/courses/page.tsx` (Modified) — 见 H1（defaultTeacherId 传参）
- `src/app/dashboard/schedule/actions.ts` (Modified) — updateLessonAction result 模式，良好
- `src/app/dashboard/schedule/attendance-actions.ts` (Modified) — note upsert，良好（见 L2）
- `src/app/dashboard/schedule/data.ts` (Modified) — 批量 join 免 N+1，良好
- `src/app/dashboard/schedule/types.ts` (Modified)
- `src/app/dashboard/schedule/lesson-detail.tsx` (Modified) — 笔记回显/点评/地点链接，良好
- `src/app/dashboard/schedule/calendar.tsx` (Modified) — eventContent + 班级筛选，良好
- `tests/section-meeting-expansion.test.ts` (Added) — 覆盖多时段核心算法
