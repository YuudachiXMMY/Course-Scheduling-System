# PR Review: #35 — feat(users): 账号管理四 Tab + 分级 RBAC + staff 管理（计划 PR-2 / 工作流 D）

**Reviewed**: 2026-09-16
**Author**: Jadyn Wu (YuudachiXMMY)
**Branch**: worktree-feat-account-rbac-staff-mgmt → main
**Decision**: COMMENT（草稿 PR — 依 code-review 约定草稿只评论、不 approve/block）

## Summary

工作流 D 实现质量高：分级授权（`assertCanManageRole`）以 page → tab → action → core 四级纵深防御落地，headless cores 直写 DB 以规避 better-auth 的 live-session 约束且可单测，停用即时失效（事务内 `banned=true` + 删 session）是对 better-auth 1.7.4 行为的正确修正。四项验证全绿，无 Critical/High/Medium。仅 3 处 LOW（并发 last-owner 竞态、表单 a11y、命名微瑕），均非阻断。

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM
None.

### LOW

1. **last-owner 守卫存在 TOCTOU 竞态** — `src/auth/staff.ts:111`（`setStaffRoleCore`）与 `:129`（`deactivateStaffCore`）：`ownerCount()` 的读取在写事务**之外**。两个超管并发降级/停用「最后两个 owner」时，各自读到 count=2（>1）均通过校验，可导致机构落到 0 owner。触发条件苛刻（需两名可信超管同时操作），且可经 `seed-admin` 恢复 → 定级 LOW。若要收敛：把 count 校验挪进 `db.transaction` 内、或对 member 表加行锁（`SELECT ... FOR UPDATE`）。

2. **建号表单输入缺少关联 `<label>`（a11y）** — `src/app/dashboard/users/staff-form.tsx:81-100`：显示名/登录邮箱/密码三个 `<input>` 仅有 `placeholder`，无 `<label htmlFor>` 或 `aria-label`。placeholder 不是可访问名称（失焦即消失、读屏支持不一）。角色 `<select>` 已用 `<label>` 包裹，风格不一致。建议补 `aria-label`。

3. **`deprovisionPortalMember` 作为 staff 回滚补偿名不符实（命名微瑕）** — `src/auth/staff.ts:89`：函数实际在事务内删 member+account+user（通用 member 拆除，回滚**正确、无孤儿**，已核实 `provision.ts:41-47`），但 `Portal` 前缀在 staff 语境下略有误导。可考虑更名为 `deprovisionMember` 或补注释。纯命名，非缺陷。

### 已核验为「非缺陷」（对抗式复核）
- 普通 admin 越权造/改/停 admin：被 `assertCanManageRole` 对**旧+新**角色双检拦截（`staff.ts:106-107`），UI 隐藏非唯一门禁 ✓
- 逗号多角色（`teacher,admin`）分类：`isAdminRole`/`roleLabel`/`isPortalRole` 均先 split，测试覆盖 ✓
- 跨租户目标：`requireStaffTarget` 按 `ctx.tenantId` 过滤 member，拒绝越界 ✓
- 改自己/停自己/降停最后 owner：均有守卫 + DB 集成测试 ✓
- client/server 边界：`staff-form` 用 `import type { CreateStaffInput }`（运行时擦除），build 边界干净 ✓
- 业务错误以 DATA 返回（非 throw）：规避 Next 生产环境 Server Action 报文脱敏 ✓

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass — 0 error |
| Lint (`eslint .`) | Pass — 0 warning |
| Tests (`vitest run`) | Pass — 139 tests / 21 files（新增 16：7 纯函数 + 9 DB 集成，对真实 Postgres） |
| Build (`next build`) | Pass — `/dashboard/users` 动态路由生成，client/server 边界干净 |

## Files Reviewed

| File | Change |
|---|---|
| `src/auth/roles.ts` | Added — 纯角色标签/分类（STAFF_ROLES / ADMIN_TIER_ROLES / roleLabel / isAdminRole） |
| `src/auth/staff-authz.ts` | Added — `isSuperAdmin` / `assertCanManageRole` 分级授权 |
| `src/auth/staff.ts` | Added — 建/改角色/停用/启用 cores + 守卫 |
| `src/app/dashboard/users/data.ts` | Modified — 新增 `StaffRow` + `listStaff` |
| `src/app/dashboard/users/staff-actions.ts` | Added — 四个 Server Action（五步边界） |
| `src/app/dashboard/users/staff-form.tsx` | Added — 建号表单（Client） |
| `src/app/dashboard/users/staff-controls.tsx` | Added — 行内角色/停用控件（Client） |
| `src/app/dashboard/users/teachers-tab.tsx` | Added — 教师/助教 Tab（Server） |
| `src/app/dashboard/users/admins-tab.tsx` | Added — 管理员 Tab（超管可写、普管只读） |
| `src/app/dashboard/users/page.tsx` | Modified — 四 Tab + 页级门禁 |
| `src/app/dashboard/layout.tsx` | Modified — `canManageUsers` 计算并下传 |
| `src/app/dashboard/_nav/nav-links.tsx` | Modified — 「用户管理」条件渲染 |
| `tests/rbac-staff.test.ts` | Added — 7 纯函数分级矩阵 |
| `tests/staff-admin.test.ts` | Added — 9 DB 集成 |
| `tests/e2e/dashboard/users.spec.ts` | Modified — 四 Tab 断言 + 教师建号 happy path |
| `.claude/PRPs/reports/account-rbac-and-admin-seed-pr2-report.md` | Added — 实施报告 |

## Follow-ups（非本 PR 阻断）

- 需 teacher/超管 storageState 的 e2e：教师 302、超管 vs 普管写权限差异（当前仅 owner storageState，无法覆盖）
- 工作流 E（教师本班数据收敛）按计划留作 PR-3
