# Implementation Report: 账号管理 RBAC 分级 + staff 管理（PR-2 / 工作流 D）

## Summary
实现计划 `account-rbac-and-admin-seed.plan.md` 的 **工作流 D**（PR-2）：把 `/dashboard/users` 从「学生/家长两 Tab、全 staff 可见」收敛为「owner/admin/超管可见的四 Tab 账号管理页」，并新增 **staff 账号分级管理**（教师/助教 由 admin+ 管理；管理员 仅超管可写、普通 admin 只读）。

前置依赖均已在 main：PR#32（`/dashboard/users` 基线，commit `97b273b`）+ PR#34（PR-1 A+B+C：禁注册 + env 播种超管，commit `61351cc`）。基线 HEAD = `61351cc`。

> 工作流 E（教师本班数据收敛，横切）按计划留作 **PR-3**，独立提交便于审查数据作用域回归。

## Assessment vs Reality
| Metric | Predicted (Plan, 工作流 D) | Actual |
|---|---|---|
| Complexity | Large | Large（符合） |
| Files | 新增 ~9 / 改 ~5 | 新增 10 / 改 5 |
| 关键偏差 | — | ban 需**额外删 session**（计划「disableCookieCache 即时生效」不完整，见 Deviations） |

## Tasks Completed
| # | Task | 状态 | 备注 |
|---|---|---|---|
| D0 | 分级授权助手 | ✅ | 拆为 `src/auth/roles.ts`(纯) + `src/auth/staff-authz.ts`(server-only)，见 Deviations |
| D1 | 页级门禁 admin+ + 4 Tab | ✅ | `page.tsx` 用 `redirect` 软门禁 |
| D2 | `listStaff` 数据层 | ✅ | `!isPortalRole` 过滤，带 `banned` |
| D3 | staff 核心 + Server Actions | ✅ | `staff.ts` 4 cores + `staff-actions.ts` 五步范式 |
| D4 | UI（teachers/admins tab + form + controls） | ✅ | 写控件仅 `isSuperAdmin` 渲染 + 核心再校验 |
| D5 | staff DB 集成测试 | ✅ | `tests/staff-admin.test.ts`（9 例，真实 DB 通过） |
| D6 | 分级 RBAC 纯函数矩阵 | ✅ | `tests/rbac-staff.test.ts`（7 例） |
| D7 | 导航条件渲染 | ✅ | `layout.tsx` 计算 `canManageUsers` 传 `NavLinks` |

## Validation Results
| Level | Status | 备注 |
|---|---|---|
| Typecheck (`tsc --noEmit`) | ✅ Pass | 全项目 0 error |
| Lint (`eslint .`) | ✅ Pass | 0 warning / 0 error |
| Unit/集成 (`vitest run`) | ✅ Pass | **139 tests / 21 files 全绿**，含新增 16（7 纯 + 9 DB 集成，对真实 Postgres 验证） |
| Build (`next build`) | ✅ Pass | `/dashboard/users` 动态路由生成；client/server 边界干净（需真实 node_modules，worktree 内 `npm ci`） |

## Files Changed
| File | Action | 说明 |
|---|---|---|
| `src/auth/roles.ts` | CREATE | 纯:`roleLabel`/`isAdminRole`/`STAFF_ROLES`(可被 client 导入) |
| `src/auth/staff-authz.ts` | CREATE | server-only:`isSuperAdmin`/`assertCanManageRole`(分级支点) |
| `src/auth/staff.ts` | CREATE | cores:create/setRole/deactivate/reactivate（直写 member.role/user.banned + 删 session） |
| `src/app/dashboard/users/data.ts` | UPDATE | +`listStaff(ctx)` |
| `src/app/dashboard/users/staff-actions.ts` | CREATE | 五步范式 Server Actions |
| `src/app/dashboard/users/staff-form.tsx` | CREATE | client 建号表单（type-only 导入 CreateStaffInput，不泄漏 server-only） |
| `src/app/dashboard/users/staff-controls.tsx` | CREATE | client 行控件(角色 select + 停用/启用) |
| `src/app/dashboard/users/teachers-tab.tsx` | CREATE | server 教师/助教 tab |
| `src/app/dashboard/users/admins-tab.tsx` | CREATE | server 管理员 tab，写控件仅超管 |
| `src/app/dashboard/users/page.tsx` | UPDATE | 门禁 admin+ + 4 Tab |
| `src/app/dashboard/layout.tsx` | UPDATE | 计算并传 `canManageUsers` |
| `src/app/dashboard/_nav/nav-links.tsx` | UPDATE | `用户管理` 按 `canManageUsers` 条件渲染 |
| `tests/rbac-staff.test.ts` | CREATE | 分级矩阵纯函数（7） |
| `tests/staff-admin.test.ts` | CREATE | staff cores DB 集成（9） |
| `tests/e2e/dashboard/users.spec.ts` | UPDATE | 四 Tab 断言 + 教师建号 happy path |

## Deviations from Plan
1. **ban 必须额外删 session（安全修正）**：计划称「`getAuthContext` 已 `disableCookieCache` → 停用即时生效」，但核对 better-auth 1.7.4 源码（`plugins/admin/admin.mjs`）后确认：`banned` 只在 `session.create.before`（登录时）检查，**getSession 不查 banned**。`auth.api.banUser` 之所以即时生效，是因为它额外调用 `deleteUserSessions`。故 `deactivateStaffCore` 在一个事务内 `banned=true` **并删除该用户全部 session 行**，否则已登录用户会继续「滑行」。已由集成测试断言 session 被删。
2. **D0 拆两模块**：把纯展示/分类（`roleLabel`/`isAdminRole`）放入无 `server-only` 的 `src/auth/roles.ts`，使 client 组件可安全导入；授权函数留在 `server-only` 的 `staff-authz.ts`。避免把 server-only 拉进 client bundle。
3. **staff 建号拒绝复用邮箱**（吸取工作流 A/PR#32 MEDIUM 教训）：与门户「同组邮箱静默复用」不同，staff 登录邮箱冲突**显式报错**「该邮箱已被占用」，避免误报「已设密码」。

## Issues Encountered
- **worktree build 需真实 node_modules**：Turbopack 拒绝指向 worktree 外的 node_modules 软链（"points out of the filesystem root"）。解决:worktree 内 `npm ci` 装真实依赖后 build 通过。（与既有 memory 一致）

## Tests Written
| Test File | Tests | 覆盖 |
|---|---|---|
| `tests/rbac-staff.test.ts` | 7 | `assertCanManageRole` 分级矩阵 + `isSuperAdmin`/`isAdminRole`/`roleLabel`（含逗号多角色） |
| `tests/staff-admin.test.ts` | 9 | admin 建 teacher✓/建 admin✗、超管建 admin✓、邮箱冲突拒绝、分级改角色、ban+删 session、自停用/最后 owner/跨租户守卫 |
| `tests/e2e/dashboard/users.spec.ts` | +1 | 四 Tab 可见 + 教师建号（owner storageState 可测） |

## 分级模型（核对无误）
- `requirePermission(ctx, perm)`：`ctx.isPlatformAdmin` 时直接放行（超管万能）。
- `assertCanManageRole(ctx, targetRole)`：目标含 owner/admin → 仅超管；否则 → `member:['create']`（owner/admin 满足，teacher 不满足）。
- 纵深防御:page(redirect) → tab(`requirePermission member:create`) → action(粗门禁 member:create) → core(细 `assertCanManageRole` 对**旧+新**角色)。UI 隐藏写控件**从不是唯一门禁**。

## Next Steps
- [ ] Code review（本 PR 已跑对抗式审查 workflow）
- [ ] 合并后接 **PR-3（工作流 E：教师本班数据收敛）**
- [ ] E2E 补充需 teacher / 超管 storageState 的用例（教师 302、超管/普管写权限差异）—— 当前 owner storageState 无法覆盖，列为后续
