# PR Review: #10 — feat(phase-7a): portal + reschedule-request — plan + server core (PR-1)

**Reviewed**: 2026-09-14
**Author**: Jadyn Wu (YuudachiXMMY)
**Branch**: worktree-prp-phase7-portal-reschedule-plan → main
**Decision**: COMMENT (draft PR) — 无阻断项；1 个 MEDIUM（供应流程非原子）+ 若干 LOW（均为已知边界/PR-2 遗留/清理项）

## Summary

Phase 7a PR-1（服务端核心，Tasks 0–8 + 核心 DB 测试）：家长/学生登录门户与「改期申请→教师审批」工作流的 schema / auth / 业务逻辑地基。**无 UI、无 HTTP 端点**（PR-2 交付），因此 PR-1 尚无对外攻击面，安全性完全依赖 PR-2 的 Server Action 包装器正确调用 `requirePermission`。

审查重点为逻辑正确性、多租户/行级隔离、以及与既有约定（`forTenant`、report-core 拆核、权限矩阵）的一致性。核对结论：

- **契约全部匹配** — `forTenant(ctx).select(t, where)` / `.findById` / `.insert` / `.update` 返回值形状与 `src/db/tenant.ts` 一致；`rescheduleLessonCore(ctx, {id,startAt,endAt})` 签名与 `ScheduleResult`（`conflicts.title: string | null`）吻合；`approve/reject/cancel/create` 核复用既有 `rescheduleLessonCore` 做字节一致的冲突检测。
- **RBAC 矩阵属实** — `permissions.ts` 中 `parent`/`student` = `rescheduleRequest:[create,read,list,cancel]`（无 approve/reject、无 lesson 写权）；`teacher/admin/owner` 含 `approve/reject`；`member:['create']` 仅 owner/admin。`rbac-reschedule.test.ts` 锁定该矩阵，实跑通过。
- **行级隔离正确** — `resolveLinkedStudentIds`/`assertLinkedToStudent` 仅以已验证的 `ctx.userId` 为谓词（绝不取请求参数），叠加 `forTenant` 的 tenant 谓词；`portal-scope.test.ts` 证实同租户「他人孩子」与跨租户访问均被拒。
- **审批状态机正确** — 冲突（软 CONFLICT 或 GiST 23P01 抛 `ConflictError`）时申请保持 `pending`、课节不移动；`reschedule-core.test.ts` 证实。`reschedule_request.lessonId` 的 `ON DELETE cascade` 使「课节删除后审批悬挂申请」不可能发生。

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM

1. **供应流程非原子，且无幂等**（`src/app/dashboard/students/portal-actions.ts:41-54` + `src/auth/provision.ts:19-26`）
   `provisionPortalAccount` 依次执行：`findById(student)` → `provisionPortalMember`（`auth.api.createUser` + `auth.api.addMember`）→ `insert(portalLink)`。三步跨 Better Auth API 与 Drizzle，**无补偿/回滚**：
   - 若 `addMember` 或 `insert(portalLink)` 失败，`createUser` 已创建的 auth user（及可能的 membership）成为孤儿——该用户能通过邮箱+密码认证，但 `session.create.before` 解析不到 org（或解析到 org 却无 portalLink），登录后被门户/仪表盘反复弹回。
   - **无幂等**：`uq_portal_link_student_user` 建在 `(tenantId, studentId, userId)` 上，而每次调用都新铸一个 `userId`（合成邮箱含新 `nanoid`）。对同一「家长+学生」重复调用会产生**多个独立登录账号**，唯一索引形同虚设。
   `auth.api.createUser` 无法并入 Drizzle 事务，完全原子较难；MVP（owner 手动供应）可接受，但建议：(a) 供应前按自然键（如真实邮箱、或 studentId+relationship）查重并复用/拒绝；(b) 至少在 `portalLink` 插入失败时清理已建 user，或记录可恢复的操作日志。**当前为 owner 门控、非对外接口，故列 MEDIUM 而非 HIGH。**

### LOW

1. **群体课节语义**（`src/lib/reschedule-core.ts:96-100`）— 审批调用 `rescheduleLessonCore(ctx, {id: req.lessonId})` **移动整节课**。`reschedule_request.studentId` 记录了「哪个孩子」发起，但审批仍移动共享 section 的课节，即一位家长的改期一旦通过会影响该节课全部（最多 15 名）在读学生。这是 `rescheduleLessonCore` 只能整体移动课节的固有限制，属产品语义边界（1v1 场景无碍，群体课需产品确认），非代码缺陷。建议在 PR-2 UI 或后续明确「群体课改期」策略。

2. **申请未留存原始课节时间**（`src/db/schema/reserved.ts:15-34`）— `reschedule_request` 仅存 `requestedStartAt/EndAt`，不存审批时课节的「原时间」。审批后原时间仅能从课节 `updatedAt`/`isException` 间接追溯，审计/历史略弱。LOW。

3. **行级 scope 未叠加角色判定**（`src/auth/portal.ts:19-33`）— `resolveLinkedStudentIds`/`assertLinkedToStudent` 纯以 `portalLink` 为据；今天安全（link 仅对 parent/student 创建），但若将来某 staff 用户被误建 portalLink 即获得该孩子访问权。纵深防御建议：写路径叠加 `isPortalRole(ctx.role)`（或由 PR-2 页面门控保证）。LOW。

4. **工作树含未提交的部分格式化改动 + prettier 非 gate**（5 个 tracked 文件 dirty）— HEAD（`ad3143c`）为未换行长行，工作树有**部分** prettier 换行（`reschedule-core.ts` 等），但 `provision-portal.test.ts` 即便在工作树里仍未完全 prettier-clean。核实：CI（`.github/workflows/ci.yml`）不跑 `prettier --check`，`lint`/`check` 脚本也不含 prettier，且 `schedule-core.ts` 等 4 个既有文件本就未过 prettier 却已合并——**prettier 在本项目非 gate**，不影响合并。属清理项：合并前请让工作树干净（`pnpm format` 全库一次并单独提交，或丢弃这批零散改动），避免 PR 之外的 dirty 状态。LOW/流程。

### 供 PR-2 注意（非 PR-1 缺陷）
- **核无自门控是设计**（与 report-core 一致）：`reschedule-core.ts` 各核与 `rescheduleLessonCore` 均**不**调用 `requirePermission`。PR-1 无端点故无风险，但 PR-2 每个 Server Action 包装器**必须**先 `requireAuthContext` → `requirePermission(ctx, { rescheduleRequest: ['approve'|'reject'|'cancel'|'create'] })` 再调核，并 `revalidatePath`。这是 PR-2 最关键的正确性点。

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass — 本次复核实跑，零错误 |
| Lint (`eslint .`) | Pass — 本次复核实跑，零错误/零警告 |
| Tests (`pnpm test`) | Pass — 本次复核实跑 **15 文件 / 99 测试全绿**（对 5544 实时 Postgres，含 RBAC 矩阵、改期生命周期+冲突、同租户/跨租户行级隔离、供应+hook 分支） |
| Build (`next build`) | Pass（implement 轮实跑通过；CI 以 Docker `test`/`runtime` 多阶段镜像 gate，`next build` 内含类型检查+ESLint）— 本次未重复重量级构建 |

## Files Reviewed

源码（10 新增 / 5 修改，含迁移）：
- `src/db/schema/enums.ts` (Modified) — `+ portalRelationship` 枚举 ✓
- `src/db/schema/portal-link.ts` (Added) — user↔student join；`(tenantId,studentId,userId)` 唯一索引 + 复合 FK→student(cascade) + 两条覆盖索引；`userId` 裸 text 无 FK（auth-owned 约定一致）✓
- `src/db/schema/reserved.ts` (Modified) — `+ reschedule_request.studentId`（可空，迁移安全）+ `fk_reschedule_student`(cascade) + `idx_reschedule_tenant_student` ✓
- `src/db/schema/index.ts` (Modified) — 导出 portal-link ✓
- `drizzle/0006_wonderful_sumo.sql` (+meta) (Added) — 仅新增枚举/表/列 + FK/索引，与 schema 一致；迁移序列 0000→0006 完整 ✓
- `src/env.ts` (Modified) — `+ PORTAL_EMAIL_DOMAIN`（默认 `portal.local`）✓
- `src/auth/auth.ts` (Modified) — `user.create.after` 分支：仅 `/sign-up/email` 自建租户；`context` undefined 时安全跳过 ✓（P7a-2 由 `provision-portal.test.ts` 运行时证实「恰好一条 membership，无 junk org」）
- `src/auth/portal.ts` (Added) — `isPortalRole`（拆逗号多角色）/ `resolveLinkedStudentIds` / `assertLinkedToStudent` ✓
- `src/auth/provision.ts` (Added) — `provisionPortalMember`；置于 auth 层避免 db→auth 循环依赖（合理偏离）✓（见 MEDIUM-1）
- `src/lib/reschedule-core.ts` (Added) — create/approve/reject/cancel 状态机；approve 复用 `rescheduleLessonCore`，冲突留 `pending` ✓
- `src/app/dashboard/students/portal-actions.ts` (Added) — `provisionPortalAccount` 动作，4 步模板 + 合成占位邮箱 ✓（见 MEDIUM-1）
- `src/app/portal/data.ts` (Added) — `getPortalSchedule` 复用 Phase-4 `getStudentLessonsForTenant` + `cardWindow` ✓

测试（4 文件，+16）：
- `tests/rbac-reschedule.test.ts` (Added) — 纯 `can()` 矩阵 + `isPortalRole`（4）✓
- `tests/reschedule-core.test.ts` (Added) — DB 集成生命周期（8）：create / approve(free) / approve(conflict→pending) / reject / cancel / unlinked / not-enrolled / double-process ✓
- `tests/portal-scope.test.ts` (Added) — 行级隔离（3）：本孩子 / 同租户他人孩子拒 / 跨租户拒 ✓
- `tests/provision-portal.test.ts` (Added) — 供应+hook 分支（1）：恰好一条 tutor-org membership ✓

产物（非源码）：
- `.claude/PRPs/plans/phase-7a-portal-reschedule.plan.md` (Added) — 计划
- `.claude/PRPs/reports/phase-7a-portal-reschedule-report.md` (Added) — PR-1 实现报告；偏离与遗留逐条属实 ✓
- `.claude/PRPs/prds/course-scheduling-system.prd.md` (Modified) — Phase 7 拆分为 7a(in-progress)+7b–7e(pending)，链接解析 ✓

---

## Resolution — MEDIUM-1 已修复（后续提交）

**修复提交**：在 `worktree-prp-phase7-portal-reschedule-plan` 上追加，重写 `src/auth/provision.ts` + `src/app/dashboard/students/portal-actions.ts` + `tests/provision-portal.test.ts`。

**做法**（既修复 MEDIUM-1，又不引入新漏洞）：
1. **补偿式原子性** — 新增 `deprovisionPortalMember(userId)`（member+account+user，**单事务**内删除）。`createUser` 后若 `addMember` 或 `portalLink` 插入失败，删除刚铸的孤儿 user；仅当本次调用 `created===true`（新铸用户）才拆除，复用既有成员时不误删。
2. **按邮箱幂等 + 防劫持** — 按已验证 email 查已有 user：已存在**且已是本 org 成员**才复用（支持「一位真实邮箱家长→多个孩子」，且再供应同 (email,student) 为无操作）；存在但**不在本 org** 则抛「该邮箱已被其他账号占用」**拒绝**，绝不按邮箱把外部账号注入本租户（无跨租户成员注入）。合成邮箱（无 loginId）路径不变。
3. **拆无头 core** `provisionPortalAccountCore(ctx, input)`（遵循 report-core/reschedule-core 约定），action 变薄包装器（`requireAuthContext → requirePermission({member:['create']}) → core → revalidatePath`）。

**校验**：typecheck ✓ · eslint ✓（0 警告）· `next build` ✓ · **`pnpm test` 102/102**（供应用例 4 条：全新+幂等+多孩子 / 防劫持跨租户拒绝 / addMember 失败回滚无孤儿 / 合成邮箱；较原 99 净 +3）。

**对抗式验证**（3 个独立 verifier，安全/正确性并发/约定三视角）：三大声明（原子性、幂等、防劫持）在顺序流下均**未被证伪**，无跨租户劫持、无提权、无纯成功路径下的数据损坏。

**残留 LOW（已知、非阻断，未在本轮修复）**：
- **并发采纳-拆除竞态** — A(新 email, sA) 与 B(同 email, sB) 并发：A 提交 user+member 后自身 link 插入遇瞬时故障 → A 全局拆除该 user → B 已用该 user 链接 sB，指向被删 user。需瞬时 DB 故障 + 精确交错，重试自愈，不授予越权。
- **portalLink 检查后插入 TOCTOU** — 并发同 (tenant,student,user) 供应会以原始唯一索引冲突报错而非幂等无操作（无数据损坏；因 `created===false` 不会误拆用户）。可用 `onConflictDoNothing` 硬化。
- **异 kind 复用为静默无操作** — 先以 parent 供应、后以 student 再供应同 (email,student)，`relationship`/member role 不更新（陈旧关系，非安全问题）。
- **邮箱枚举** — 区分「他处已存在」与「空闲」的错误信息对已认证 org 管理员泄露账号存在性（调用方已受权，可接受）。
- 建议后续以 `onConflictDoNothing` + 竞态守卫收口这些边界；`deprovisionPortalMember` 已加契约注释（仅可对本进程新铸的单成员用户调用）。
