# Code Review: 班级工作台「排课」Tab 行内统一管理笔记/点评/成绩

**Reviewed**: 2026-09-16
**Branch**: feat/section-unified-notes-comments
**Mode**: Local (uncommitted changes)
**Decision**: APPROVE — 无 Critical/High;Medium(M1)已修复,余下 Low 可选

> 更新:M1 已修复(`lesson-notes-inline.tsx` 三个 save handler 保存成功后新增 `router.refresh()`,并订正文件头注释)。typecheck / lint 复核通过。

## Summary
安全与租户隔离扎实(全部走 `forTenant(ctx)`、`requirePermission(lesson:update)`、zod 校验、无原始 SQL/密钥/注入面),类型/lint/单测全绿。主要问题是**行内编辑器的状态回源**:保存后不刷新,父组件 `notes` prop 在首屏后被冻结,折叠再展开会显示保存前的旧值(数据已正确落库,仅 UI 误导)。

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM

**M1 — 保存后行内编辑器再展开显示陈旧数据(状态回源缺失)**
`src/app/dashboard/teach/[sectionId]/lesson-notes-inline.tsx`
- `LessonNotesInline` 通过 `useState(() => initial.*)` 从父级静态 prop `notes[l.id]` 播种。该 prop 在 `LessonsPanel`(RSC)→ `SectionLessons`(client)首屏渲染时捕获**一次**,之后永不更新。
- 复用的 `upsertSharedNote/upsertStudentNote` 与新增的 `upsertLessonStudentGrade` 都只 `revalidatePath('/dashboard/schedule')`,**不含当前 teach 路径**,且本组件保存后**没有 `router.refresh()`**。
- 复现:展开某课节 → 编辑并保存 Summary/点评/成绩(local state 显示成功)→ 折叠 → 再展开。组件重挂载,`initial` 仍是首屏旧值 → 刚保存的内容"消失"(实际已入库)。同一页的 `LessonDetail` 抽屉每次打开都 `useEffect` 重新拉取(见 `lesson-detail.tsx:42-60`),因此抽屉显示新值、行内显示旧值,**同一课节两处不一致**。
- 文件头注释称"mirrors LessonDetail"并不准确:LessonDetail 每次打开重新 fetch,本组件从冻结 prop 播种。
- **建议**:每次保存成功后调用 `router.refresh()`(与本仓 `section-lessons.tsx` 的 `submitReschedule`/`generate` 一致),或让 note/grade action 追加 `revalidatePath` 到 teach section 路径。前者最小改动。

### LOW

**L1 — 保存处理函数缺少 try/catch**
`lesson-notes-inline.tsx:43,56,75` — `saveSummary/saveComment/saveGrade` 在 `startTransition` 内 `await` action 但无 try/catch。action 拒绝(如成绩超 `max(9999)`、瞬时 DB 错误)会成为未处理拒绝,可能触发 error boundary。与 `LessonDetail` 现有写法一致(既有模式),但成绩的 `max` 上限是**新增的可抛出面**。建议像 `submitReschedule` 那样兜底为红色错误提示。

**L2 — 表单控件仅用 placeholder 标注(a11y)**
`lesson-notes-inline.tsx` textarea/number 输入无 `<label htmlFor>` 关联;学生名是 `<span>` 而非 label。屏幕阅读器在输入后失去 placeholder 上下文。建议加 `aria-label`。

**L3 — 成绩 update 路径会清空既有 comment**
`data.ts:269` — 更新分支恒设 `comment: data.comment || null`。UI 从不传 comment,故仅在"未来通过其他路径给哨兵行写过 comment"时才丢失。当前哨兵行(`QUICK_GRADE_TITLE`)只由此路径创建、从不带 comment,属理论问题;但注释称 `grade.comment` "留作未来用",建议改为仅在提供时才覆盖。

**L4 — 无 `score <= maxScore` 交叉校验**
`grade-actions.ts:17-18` — 可录入 120/100。若为有意(加分)可忽略,标注供决策。

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (`eslint .`) | Pass |
| Unit tests (`vitest tests/section-notes.test.ts`) | Pass (5/5) |
| Build (`next build`) | Skipped(typecheck 已覆盖;db:generate 前已确认零迁移) |
| E2E | Blocked(陈旧 :3000 容器,详见实现报告) |

## Files Reviewed
- `src/app/dashboard/teach/[sectionId]/data.ts` — Modified
- `src/app/dashboard/teach/[sectionId]/grade-actions.ts` — Added
- `src/app/dashboard/teach/[sectionId]/lesson-notes-inline.tsx` — Added
- `src/app/dashboard/teach/[sectionId]/section-lessons.tsx` — Modified
- `src/app/dashboard/teach/[sectionId]/tabs/lessons-panel.tsx` — Modified
- `tests/section-notes.test.ts` — Added
- `tests/e2e/dashboard/teach-notes.spec.ts` — Added
