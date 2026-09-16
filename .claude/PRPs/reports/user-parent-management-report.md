# Implementation Report: 用户管理页面 — 学生/家长统一管理与关联

## Summary
新增 `/dashboard/users`(学生/家长 Tab),把学生列表迁入,新增家长(门户账号)管理与**双向关联**(把已有家长 assign 到学生 / 把学生 assign 到家长)。家长在数据层即门户登录账号,完全复用 `provisionPortalMember`/`portalLink`,**无新表、无迁移**。旧 `/dashboard/students` 302 重定向;导航「学生」改为「用户管理」。

## Assessment vs Reality
| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium | Medium |
| Confidence | 8/10 | 达成(单次实现,仅 1 处 RSC 边界修正) |
| Files Changed | 新增 ~8 / 改 ~5 | 新增 8 / 改 5 |

## Tasks Completed
| # | Task | Status | Notes |
|---|---|---|---|
| 1 | createPortalUserCore | ✅ | provision.ts 追加 |
| 2 | link/unlinkPortalUserCore | ✅ | 幂等/防跨租户/tenantId 显式 |
| 3 | listPortalUsers (data.ts) | ✅ | member 直查 + isPortalRole 过滤 |
| 4 | user-actions.ts | ✅ | 五步范式 + data-error |
| 5 | user-form / link-control | ✅ | **偏差**:LinkControl 去掉函数 prop(见下) |
| 6 | students-tab.tsx | ✅ | 迁入学生页 + 关联账号 |
| 7 | parents-tab.tsx | ✅ | 纵深权限守卫 |
| 8 | users/page.tsx | ✅ | Tab 路由 + 权限收敛,await searchParams |
| 9 | students/page.tsx redirect | ✅ | 302 |
| 10 | nav-links.tsx | ✅ | 学生→用户管理,更新注释 |
| 11 | smoke/students e2e 同步 | ✅ | |
| 12 | tests/portal-admin.test.ts | ✅ | 5 用例全绿 |
| 13 | tests/e2e/dashboard/users.spec.ts | ✅ | 见 e2e 说明 |

## Validation Results
| Level | Status | Notes |
|---|---|---|
| Static (typecheck) | ✅ Pass | `tsc --noEmit` 0 错误 |
| Static (lint) | ✅ Pass | eslint 0 warning |
| Unit Tests | ✅ Pass | 18 文件 / 119 用例全绿(含新增 5) |
| Build | ✅ Pass | `next build` 成功,`/dashboard/users` 路由生成 |
| Integration (e2e) | ⚠️ 未在本环境执行 | 端口 3000 被既有 app 占用,playwright `reuseExistingServer:true` 附着到旧代码实例 → 规格跑到了陈旧 app;不可强占用户运行中的服务。规格选择器已逐条比对组件属性 |
| Edge Cases | ✅ Pass | 幂等/防跨租户/学生校验/租户隔离/多角色逗号串,均由单测覆盖 |

## Files Changed
| File | Action |
|---|---|
| `src/auth/provision.ts` | UPDATED(+3 核心) |
| `src/app/dashboard/users/page.tsx` | CREATED |
| `src/app/dashboard/users/students-tab.tsx` | CREATED |
| `src/app/dashboard/users/parents-tab.tsx` | CREATED |
| `src/app/dashboard/users/data.ts` | CREATED |
| `src/app/dashboard/users/user-actions.ts` | CREATED |
| `src/app/dashboard/users/user-form.tsx` | CREATED |
| `src/app/dashboard/users/link-control.tsx` | CREATED |
| `src/app/dashboard/students/page.tsx` | UPDATED(→redirect) |
| `src/app/dashboard/_nav/nav-links.tsx` | UPDATED |
| `tests/portal-admin.test.ts` | CREATED |
| `tests/e2e/dashboard/users.spec.ts` | CREATED |
| `tests/e2e/dashboard/smoke.spec.ts` | UPDATED |
| `tests/e2e/dashboard/students.spec.ts` | UPDATED |

## Deviations from Plan
1. **LinkControl props(Task 5)**:计划用 `resolve` 回调 prop。实测 `next build` 暴露:从服务端组件向客户端组件传**函数** prop 违反 React RSC 序列化规则(build/运行时报错)。改为仅传可序列化的 `fixedUserId?`/`fixedStudentId?` + `options`,relationship 由服务端从 member.role 推断。功能等价。

## Issues Encountered
- **worktree build**:嵌套 git worktree 无本地 node_modules,Turbopack 拒绝向上解析/拒绝越界软链。解决:在 worktree 内 `npm install --prefer-offline`(9s,lockfile 未变);build 遂通过。
- **e2e 陈旧服务**:见上 Integration 行。

## Tests Written
| Test File | Tests | Coverage |
|---|---|---|
| `tests/portal-admin.test.ts` | 5 | create/link/unlink 核心:建号解耦、幂等、防跨租户注入、学生校验、租户隔离解绑 |
| `tests/e2e/dashboard/users.spec.ts` | 3 | Tab 渲染、新建家长、关联/解绑学生 |

## Next Steps
- [ ] 在可用端口/干净环境执行 e2e(`npm run test:e2e -g 用户`)以最终确认 UI 选择器。
- [ ] `/code-review` 复审(重点:租户/跨机构边界)。
- [ ] PR #32 已含计划+实现(draft)。
