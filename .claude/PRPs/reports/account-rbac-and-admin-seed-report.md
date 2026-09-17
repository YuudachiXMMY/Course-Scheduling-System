# Implementation Report: 账号管理 RBAC 分级 + 禁用自助注册 + env 播种默认超管

> Plan: `.claude/PRPs/plans/account-rbac-and-admin-seed.plan.md`(PR #33,纯计划文档)
> 执行:`/ecc:prp-implement`(ultracode)· 分支 `worktree-feat+account-rbac-and-admin-seed`(基于 main @ PR#32 合并)

## Summary

实现计划的 **PR-1(工作流 A + B + C)** —— 计划自身定义的「最小可部署闭环」:

- **A** 修 PR#32 MEDIUM:`createPortalUserCore` 透出 `created` 标志,复用本机构既有邮箱时 UI 不再谎报「已新建」。
- **B** 禁用自助注册:服务端 `emailAndPassword.disableSignUp` + `/signup` 302→`/login` + 移除登录页注册链接 + 清理 e2e。
- **C** env 播种默认超管:幂等 `scripts/seed-admin.ts`(默认机构 + owner member + 平台 superadmin),docker entrypoint 在 migrate 后跑,esbuild 打包 `dist/seed-admin.mjs`。

**工作流 D(账号管理四 Tab RBAC + staff 管理)与 E(教师本班收敛)未包含在本 PR**,原因见下节「Scope 决策」。

## Scope 决策(为何只做 A+B+C)

1. 计划为 **XL**,其自身「实施顺序与 PR 拆分」明确建议:PR-1=A+B+C(可部署闭环)、PR-2=D、PR-3=E(横切数据作用域,强烈建议独立 PR 便于审查数据越权回归)。
2. A+B+C 自洽、可独立部署、且**当前环境即可完整测试**(本地 Postgres 可用);D 依赖 A+B+C 的超管基线。
3. **关键 better-auth 发现改变了 D 的设计**(见下),D 需重新设计并新增 e2e seed(superadmin 账号),更适合作为严谨的 PR-2 单独落地。

## ⚠️ 关键发现(影响后续 D 的实现)

核对**已合并 main** 的 better-auth 1.7.4 装机版源码(证据见 `node_modules/better-auth/dist/plugins/*`):

| API | 是否可无 header(可信服务端)调用 | 结论 |
|---|---|---|
| `auth.api.createUser` | ✅ 是(admin 插件的例外,无 session 检查) | seed / 建号可用 |
| `auth.api.addMember` | ✅ 是(server-only,自身不做 session/权限检查) | seed / 建号可用 |
| `auth.api.setRole`(平台角色) | ❌ 否(`requireHeaders:true`) | 平台角色改**直写 `user.role`** |
| `auth.api.banUser` / `unbanUser` | ❌ 否(`adminMiddleware` 需 session) | D 的「停用」需**直写 `user.banned` + 删 session**,不能用 |
| `auth.api.updateMemberRole` | ❌ 否(`requireHeaders:true` + `orgSessionMiddleware`,且入参是 `memberId` 非 `userId`) | D 的「改角色」需**直写 `member.role`** |

> **对 D 的影响**:计划 Task D3 原写「`auth.api.banUser`/`updateMemberRole`」不可行(普通 admin 的 Server Action 无 better-auth admin session,且普通 admin 非平台 admin,adminMiddleware 会拒)。D 必须改为在 `assertCanManageRole(ctx, targetRole)` 守卫下**直写 DB**(`member.role` / `user.banned`),并自行处理会话失效(ban 后删除该用户 session,`getAuthContext` 已 `disableCookieCache`);实现前需再验证「直写 banned 是否即时阻断既有会话」的语义。

其余次要发现:`disableSignUp` 在 1.7.4 确认存在(`/sign-up/email` 返回 `EMAIL_PASSWORD_SIGN_UP_DISABLED`);`organization` 插入需 `id/name/slug/createdAt`(createdAt 无 DB 默认);无 superadmin e2e 账号(D 的 e2e 需新增)。

## Tasks Completed

| # | Task | 状态 | 备注 |
|---|---|---|---|
| A1 | `createPortalUserCore` 透出 `created` | ✅ | 复用 `provisionPortalMember` 已有的 `created` |
| A2 | `CreateUserResult` 透传 `created` | ✅ | |
| A3 | UI 按 `created` 分支文案 | ✅ | created=false → 琥珀色「未新建、密码未修改」 |
| A4 | 回归用例 | ✅ | 同 loginId 二次建号 created=false、member 1 行、角色不改 |
| B1 | 服务端 `disableSignUp:true` | ✅ | 不影响 `createUser` |
| B2 | `/signup`→302、移除注册链接 | ✅ | signup 改服务端 redirect |
| B3 | e2e 清理 | ✅ | 删 `auth/signup.spec.ts`、移除 `signupLink` locator、AUTHORING.md |
| C1 | env ADMIN_* | ✅ | 2 个 optional + 3 个带默认 |
| C2 | `scripts/seed-admin.ts` | ✅ | 幂等 + advisory-lock + 可导出 `seedAdmin()` |
| C3 | `db:seed:admin` 脚本 | ✅ | |
| C4 | Dockerfile 打包 + entrypoint 钩子 | ✅ | esbuild `--conditions=react-server` |
| C5 | compose / .env.example | ✅ | `${ADMIN_EMAIL:?…}` 防死锁 |
| C6 | seed-admin 集成测试 | ✅ | 幂等 + 角色/机构正确性 |

## Validation Results

| Level | 命令 | 结果 |
|---|---|---|
| Static | `npm run typecheck` | ✅ 0 error |
| Static | `npm run lint` | ✅ 0 warning |
| Unit/集成 | `npm run test` | ✅ 122/122(串行确定性绿;新增 A4 + seed-admin 2 例) |
| Build | `npm run build` | ✅ 成功;`/signup`、`/login` 静态,`/dashboard/users` 动态 |
| Docker seed(超出计划的额外验证) | esbuild bundle → `node dist/seed-admin.mjs` | ✅ bundle 3.1mb 无 "Dynamic require";skip 路径退出 0;完整路径对真实 DB 端到端 created→existing 幂等,psql 确认 `superadmin` + owner member=1;测试数据已清理 |

## Deviations from Plan

1. **better-auth 无 header 约束**(见上)—— 仅影响 D,本 PR(A+B+C)不受影响。
2. **`vitest.config.ts` 加 `fileParallelism:false`**(计划未列):共享 DB 集成套件的全局清理在文件并行下互删在途行,触发 better-auth 非事务 `createUser` 的 account FK 违约。本 PR 新增了 seed-admin 集成测试(加大并发压力),故一并串行化使 `npm run test` 确定性绿。此前 main 已存在该隐性 flake。
3. **平台角色用直写 `user.role`**(计划 C2 步骤 4 即如此),与发现一致。

## Follow-up(后续 PR)

- **PR-2(工作流 D)**:`/dashboard/users` 收敛为 owner/admin/超管可见(教师 302)、四 Tab、`assertCanManageRole` 分级、staff 建/改/停用。**必须**按上文用直写 DB 实现停用/改角色,并新增 superadmin e2e seed 账号。
- **PR-3(工作流 E)**:教师本班收敛(`sectionIdsForActor`),横切数据作用域,独立 PR 便于审查越权回归。
- **PR #33**(纯计划文档)可在本 PR 合并后关闭或保留归档。

## Notes

- worktree 无 node_modules/.env(git-ignored);验证时从 repo 根 CoW 克隆 node_modules + 复制 .env(Turbopack 拒绝逃逸出项目根的符号链接,tsc/eslint/vitest 则接受)。
- 无 schema 迁移(复用 user/member/organization + `user.banned`)。
