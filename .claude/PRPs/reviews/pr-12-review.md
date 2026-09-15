# PR Review: #12 — fix(courses): 创建班级时缺日期报 React #441 → 改为友好校验

**Reviewed**: 2026-09-14
**Author**: YuudachiXMMY (Jadyn Wu)
**Branch**: worktree-fix-section-form-validation → main
**Decision**: COMMENT (draft PR)

## Summary

修复方向正确：把缺失的表单校验前移到客户端，让用户看到中文提示而非压缩的 React #441。改动小、自包含、风格一致，无安全问题。但只覆盖了「学期开始」这一个字段，未根治"生产环境 Server Action 错误被脱敏"这一根因——其他 schema 约束字段仍会触发同样的 #441。

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM

- **残留：其他字段越界仍会触发 #441**（`src/app/dashboard/courses/actions.ts:82,85` 对应的 `capacity` 1–15、`durationMinutes` 15–480）。
  客户端只校验了 `byDays` / `termStart` / `termEnd`，未校验 `capacity`、`duration`。若用户填入越界值（如容量 20、时长 1000），`createSection` 仍抛 ZodError，生产构建下依旧显示压缩的 React #441。
  根因是 Server Action 抛出的错误在生产环境被 Next.js 脱敏，而非某个字段本身。
  **建议**（择一）：
  1. 在 server action 内 `try/catch` 捕获 `ZodError`，`return { error: message }` 而非 throw（结构化错误可穿透脱敏，是最彻底的修法）；或
  2. 在客户端 `<input type="number">` 上加 `min`/`max` 并在 `submit()` 里镜像所有约束。

### LOW

- **`required` 属性实际不生效**（`section-form.tsx:154`）。表单没有 `<form>` 包裹，提交按钮是 `type="button"` 且通过 `onClick` 触发，浏览器原生 `required` 校验只在表单 submit 时触发，这里永远不会触发。真正兜底的是 JS 里的 `if (!termStart)`。属性无害，但会给人"原生校验已启用"的错觉；`*` 视觉标记保留即可。
- **未新增测试**。仓库用 vitest，但主要覆盖 lib/mcp，客户端表单校验分支未加测试（可能超出本 PR 范围）。

## Validation Results

| Check | Result |
|---|---|
| Type check | Skipped（主机未装 TS 工具链，构建在 Docker 内） |
| Lint | Skipped（同上，缺 eslint-config-next） |
| Tests | Skipped（同上） |
| Build | Skipped（同上） |

> 建议在容器内 `npm run check` 复验后再解除 draft。

## Files Reviewed

- `src/app/dashboard/courses/section-form.tsx` — Modified (+17 / -1)
