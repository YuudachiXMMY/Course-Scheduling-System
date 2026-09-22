# Plan: 账号管理 RBAC 分级 + 禁用自助注册 + env 播种默认超管

## Summary
把系统从「自助注册、每人自建机构」的多租户模型收敛为「单一机构、env 播种默认超管、由管理员建号」的运营模型。包含 5 条工作流:修复 PR#32 的 MEDIUM 问题、禁用 `/signup` 自助注册、部署时用 `.env` 播种默认超管、`/dashboard/users` 账号管理页做四层 RBAC 分级(学生/家长/教师/管理员)、教师数据收敛到本班(本 section)。

## User Story
As a 培训机构的运营者(默认超级管理员),
I want 部署即拿到一个由 `.env` 播种的超管账号,并能分级管理 admin/teacher/parent/student 账号,同时禁止任何人自助注册,
So that 账号体系可控、最小权限、教师看不到账号管理也看不到非本班学生。

## Problem → Solution
**现状**:任何人访问 `/signup` 即可 `authClient.signUp.email` 注册,`user.create.after` 钩子给每个新用户自建一个机构(多租户自助);`/dashboard/users`(PR#32,未合并)页级门禁是 `student:['list']`,教师可见;无 env 播种;无 teacher/admin 账号管理面;教师能看到整租户全部学生。
**目标**:关闭自助注册(UI + 服务端 `disableSignUp`);entrypoint 迁移后用 env 播种「默认机构 + 超管(平台 superadmin + 组织 owner)」;`/dashboard/users` 收敛为 owner/admin/superadmin 可见的四 Tab 账号管理页,超管独占 admin 账号写权限,普通 admin 对 admin 只读;教师被重定向出账号管理页,且教学面只见本班学生。

## Metadata
- **Complexity**: XL(建议按工作流拆成 2–3 个 PR,见「实施顺序与 PR 拆分」)
- **Source PRD**: N/A(free-form + 3 项已确认决策)
- **PRD Phase**: N/A
- **Estimated Files**: 新增 ~10 / 改 ~18

---

## 已确认决策(2026-09-16,用户拍板)
1. **教师可见范围 = 仅本班可见**:账号管理页对教师隐藏后,教师不再有全局学生名册,只在自己的排课/教务工作台里看到本班(本 section)学生 → 触发工作流 E(横切数据收敛)。
2. **普通管理员权限 = 完整管理(含停用)**:普通 admin 可创建/编辑/停用 学生/家长/教师账号;对 admin 账号**只读**(不可建/改/停用)。
3. **部署 = 全新单机构**:env 播种唯一「默认机构 + 超管」,此后所有账号都在该机构内;**无历史多租户数据迁移**(greenfield 单租户)。

## 角色映射(全局最重要的一张表)
系统有**两套独立 AC 宇宙**(见 `src/auth/permissions.ts`):

| 用户口径 | 组织角色 `member.role`(每租户) | 平台角色 `user.role`(跨租户) | `isPlatformAdmin` | 说明 |
|---|---|---|---|---|
| **默认超管 / super admin** | `owner`(默认机构) | `superadmin` | **true** | env 播种;`requirePermission` 对其**绕过**租户 RBAC(`authorize.ts:15`) |
| **管理员 / admin** | `admin` | `user`(空能力) | false | 管理 student/parent/teacher;对 admin 只读 |
| **教师 / teacher** | `teacher` | `user` | false | **不可见账号管理页**;仅本班学生 |
| 助教 / assistant | `assistant` | `user` | false | (现有)只读教学面 |
| 家长 / parent | `parent`(portal) | `user` | false | 门户 `/portal` |
| 学生 / student | `student`(portal) | `user` | false | 门户 `/portal` |

> **设计支点**:`requirePermission(ctx, perm)` 在 `ctx.isPlatformAdmin` 时 return(超管万能);`can(role, perm)` 只看**组织角色**。因此「admin 账号仅超管可写」= 在 Server Action 里对 target 角色做 `isSuperAdmin(ctx)=ctx.isPlatformAdmin` 判定;「教师/家长/学生可由 admin 管理」= `requirePermission(ctx,{member:['create']})`(owner/admin 满足,teacher/assistant 不满足)。

---

## UX Design

### Before
```
/signup ──(任何人)──▶ authClient.signUp.email ──▶ user.create.after 自建机构 ──▶ /dashboard(自己是 owner)
/login  ──▶ "还没有账号？注册" 链接 ──▶ /signup
/dashboard/students(教师可见)  ·  /dashboard/users(PR#32:student:['list'] 门禁 → 教师可见学生Tab)
教师在 /dashboard/schedule、/dashboard/teach 看到整租户全部 section 与全部学生
```

### After
```
/signup ──▶ 302 → /login(路由已删/改;服务端 emailAndPassword.disableSignUp:true 兜底,API 也拒)
/login  ──▶ 无注册链接(仅登录)
部署 entrypoint: migrate ─▶ seed-admin(env: ADMIN_EMAIL/PASSWORD → 默认机构 + owner + superadmin) ─▶ 启动
/dashboard/users(owner/admin/superadmin 可见;teacher/assistant 302 → /dashboard)
  ├─ 学生 Tab   (admin+ 可见;学生档案 + 关联账号)
  ├─ 家长 Tab   (admin+ 可见;门户账号 + 关联学生)
  ├─ 教师 Tab   (admin+ 可管:建/改/停用)
  └─ 管理员 Tab (admin+ 可见;仅超管可建/改/停用,普通 admin 只读)
教师: 无「用户管理」导航项;/dashboard/schedule、/teach、/reports 仅显示本人 section 的学生/课程
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| `/signup` | 注册表单 | 302→/login + API 拒绝 | 双层禁用 |
| `/login` 底部链接 | "注册" | 移除 | 只登录 |
| 首次部署 | 手动注册 bootstrap | env 播种超管 | 幂等 |
| `/dashboard/users` 门禁 | `student:['list']`(教师可见) | owner/admin/superadmin(教师 302) | 决策1 |
| 用户管理页 Tab 数 | 2(学生/家长) | 4(+教师/管理员) | 工作流 D |
| 管理员 Tab 写控件 | — | 仅 `isSuperAdmin` 可见 | 普通 admin 只读 |
| 顶部导航「用户管理」 | 全体 staff 可见 | 仅 owner/admin/superadmin | NavLinks 传 `canManageUsers` |
| 教师看到的学生 | 整租户 | 本班(enrollment∈本人section) | 工作流 E |

---

## Mandatory Reading

> ⚠️ **分支前提**:PR#32(`/dashboard/users` 全套实现)在分支 `worktree-users-parents-management-plan` 上,**尚未合并**。本计划以「PR#32 已合并入基线」为前提。若先做工作流 A(修 PR#32 MEDIUM),直接在该分支/合并后基线上改。以下 `src/app/dashboard/users/*`、`provision.ts` 的新增核心均指 PR#32 版本(下方快照给全)。

| 优先级 | 文件 | 行 | 为什么 |
|---|---|---|---|
| P0 | `src/auth/permissions.ts` | 全 | 两套 AC 宇宙 + 角色矩阵;新分级建立于此 |
| P0 | `src/auth/authorize.ts` | 1-18 | `requirePermission`/`can`;`isPlatformAdmin` 绕过是分级支点 |
| P0 | `src/auth/context.ts` | 1-66 | `AuthContext{userId,tenantId,role,isPlatformAdmin}`;`getAuthContext` 反查 member |
| P0 | `src/auth/auth.ts` | 11-82 | `emailAndPassword`、`user.create.after` 自建机构钩子(禁用注册后此路径消失)、admin/organization 插件 |
| P0 | `src/auth/provision.ts`(PR#32 版) | 148-249 | `createPortalUserCore(164)`/`linkPortalUserCore`/`unlinkPortalUserCore`;MEDIUM 就在 164 |
| P0 | `scripts/seed-e2e.ts` | 122-197 | `createStaff`(createUser+addMember)、`ownerCtx` 构造——seed-admin 的范式 |
| P0 | `docker/entrypoint.sh` | 全 | migrate→server;seed-admin 钩子位置 |
| P0 | `Dockerfile` | 40-55, 90-110 | migrate.mjs 的 esbuild 打包范式;seed-admin.mjs 照抄 + `--conditions=react-server` |
| P0 | `src/env.ts` | 4-41 | 新增 ADMIN_* env 的位置 + `skipValidation` 语义 |
| P1 | `src/app/dashboard/users/page.tsx`(PR#32) | 32-63 | 页级门禁 + Tab 路由;要改门禁 + 加 2 Tab |
| P1 | `src/app/dashboard/users/user-actions.ts`(PR#32) | 全 | 「五步范式」Server Action;staff-actions 照抄 |
| P1 | `src/app/dashboard/users/user-form.tsx`(PR#32) | 91-95 | MEDIUM 的错误文案「已新建」 |
| P1 | `src/app/dashboard/users/data.ts`(PR#32) | 全 | `listPortalUsers`(member 直查+isPortalRole);`listStaff` 照抄取反 |
| P1 | `src/app/dashboard/_nav/nav-links.tsx` | 43-68 | 「用户管理」导航项;需按 `canManageUsers` 条件渲染 |
| P1 | `src/app/dashboard/layout.tsx` | 14-27 | UX 级门禁;计算 `canManageUsers` 传 NavLinks |
| P1 | `tests/portal-admin.test.ts`(PR#32) | 全 | DB 集成测试范式(create/link/unlink);staff 测试照抄 |
| P1 | `tests/rbac-reschedule.test.ts` | 1-55 | `can()` 纯函数 RBAC 单测范式;分级矩阵照抄 |
| P2 | `src/app/(auth)/signup/page.tsx` | 全 | 待删/改的注册页 |
| P2 | `src/app/(auth)/login/page.tsx` | 63-68 | 待删的「注册」链接 |
| P2 | `src/db/tenant.ts` | 全 | `forTenant(ctx)`——唯一租户写路径 |
| P2 | `scripts/migrate.ts` | 全 | seed-admin 的 postgres/advisory-lock 参照 |
| P2 | `docker-compose.yml` | app.environment | 新 ADMIN_* env 注入位置(runtime 不读 .env) |
| P2(工作流E) | `src/app/dashboard/schedule/page.tsx` | 8-23 | `forTenant().select(classSection)` 全量→需按 teacher 收敛 |
| P2(工作流E) | `src/app/dashboard/courses/actions.ts` | 97-101 | `listSections` 全量→`sectionsForActor` |
| P2(工作流E) | `src/app/dashboard/students/actions.ts` | 34-38 | `listStudents` 全量→教师按 enrollment 收敛 |
| P2(工作流E) | `src/app/dashboard/teach/[sectionId]/tabs/students-panel.tsx` | 9-30 | `listStudents()` 选择器 → 教师本班 |

## External Documentation
| 主题 | 来源 | 关键结论 |
|---|---|---|
| 禁用自助注册 | `@better-auth/core/.../init-options.ts:783`(本地 node_modules) | `emailAndPassword.disableSignUp?: boolean` **存在于 1.7.4**;`/sign-up/email` 端点会被拒 |
| 服务端建号 | `better-auth/dist/plugins/admin/admin.d.mts:171` | `auth.api.createUser` = `/admin/create-user`,**不受 disableSignUp 影响**,可继续建 staff |
| 建号不自建机构 | `src/auth/auth.ts:35`(`if context?.path !== '/sign-up/email' return`) | `createUser` 走 `/admin/create-user`,钩子跳过 → 不会给 admin 塞垃圾机构 |
| 停用账号 | `better-auth` admin 插件 `banUser`;`src/db/auth-schema.ts:16` `banned` 列已存在 | 「停用」= `auth.api.banUser`(可逆);`getAuthContext` 已 `disableCookieCache` → 停用即时生效 |
| esbuild 打包 server-only | `scripts/seed-e2e.ts:5-7` + `--conditions=react-server` | `import 'server-only'` 在打包/Node 下会抛;用 `--conditions=react-server` 解析为空模块 |

> 其余均为**已确立的内部模式**,无需外部检索。

---

## Patterns to Mirror

### AUTHZ_BYPASS(超管绕过 + 组织角色判定)
```typescript
// SOURCE: src/auth/authorize.ts:8-17
export function can(role: string, permission: PermissionRequest): boolean {
  return role.split(',').map((r) => r.trim())
    .some((name) => orgRoles[name as OrgRole]?.authorize(permission).success === true)
}
export function requirePermission(ctx: AuthContext, permission: PermissionRequest): void {
  if (ctx.isPlatformAdmin) return // cross-tenant operator bypasses tenant RBAC
  if (!can(ctx.role, permission)) throw new AuthError('FORBIDDEN')
}
```

### SERVER_ACTION_五步范式(公共边界:验证 principal→RBAC→校验→租户写→revalidate;业务错误当 DATA 返回)
```typescript
// SOURCE: src/app/dashboard/users/user-actions.ts:22-33 (PR#32)
export async function createPortalUser(input: CreatePortalUserInput): Promise<CreateUserResult> {
  const ctx = await requireAuthContext()          // 1) 可信 principal + tenant(忽略客户端 orgId)
  requirePermission(ctx, { member: ['create'] })  // 2) 顶部 RBAC
  try {
    const res = await createPortalUserCore(ctx, input)
    revalidatePath('/dashboard/users')
    return { ok: true, ...res }
  } catch (e) {
    console.error('createPortalUser failed', e)
    return { ok: false, error: e instanceof Error ? e.message : '新建用户失败' } // 中文错误当 DATA
  }
}
```

### HEADLESS_CORE(建号:防跨租户注入 + 补偿无孤儿;这是 MEDIUM 的现场)
```typescript
// SOURCE: src/auth/provision.ts:58-94 (PR#32) —— createPortalUserCore(164) 复用它
export async function provisionPortalMember(args: {
  name: string; email: string; password: string; orgId: string; orgRole: 'parent' | 'student'
}): Promise<{ userId: string; created: boolean }> {
  const [existing] = await db.select({ id: userTable.id }).from(userTable)
    .where(eq(userTable.email, args.email)).limit(1)
  if (existing) {
    const [m] = await db.select({ id: member.id }).from(member)
      .where(and(eq(member.userId, existing.id), eq(member.organizationId, args.orgId))).limit(1)
    if (!m) throw new Error('该邮箱已被其他账号占用')      // 拒外组邮箱(防跨租户注入)
    return { userId: existing.id, created: false }        // ★ 本组复用:created=false(密码被忽略!)
  }
  const createdUser = await auth.api.createUser({ body: { email: args.email, password: args.password, name: args.name } })
  const userId = createdUser.user.id
  try { await auth.api.addMember({ body: { userId, role: args.orgRole, organizationId: args.orgId } }) }
  catch (e) { await deprovisionPortalMember(userId); throw e }  // 补偿:回滚 createUser,无孤儿
  return { userId, created: true }
}
```

### STAFF_CREATE_范式(seed-e2e 里的 createUser+addMember,seed-admin 与 createStaffUserCore 都照它)
```typescript
// SOURCE: scripts/seed-e2e.ts:122-132
async function createStaff(acct): Promise<string> {
  const created = await auth.api.createUser({ body: { email: acct.email, password: acct.password, name: acct.displayName } })
  await auth.api.addMember({ body: { userId: created.user.id, role: acct.memberRole, organizationId: E2E_TENANT_ID } })
  return created.user.id
}
// 手工构造可信 ctx(seed 场景无 headers):
const ownerCtx: AuthContext = { userId: ownerId, tenantId: E2E_TENANT_ID, role: 'owner', isPlatformAdmin: false }
```

### 门户账号列举(member 直查 + isPortalRole 过滤;listStaff 取反照抄)
```typescript
// SOURCE: src/app/dashboard/users/data.ts:21-29 (PR#32)
export async function listPortalUsers(ctx: AuthContext): Promise<PortalUserRow[]> {
  const rows = await db.select({ userId: user.id, name: user.name, email: user.email, role: member.role })
    .from(member).innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, ctx.tenantId))
  const portalUsers = rows.filter((r) => isPortalRole(r.role)) // 逗号多角色 → JS 过滤,不能 inArray
  // ...
}
```

### 页级三层纵深门禁(page 折叠 + 组件重校验 + action 再校验)
```tsx
// SOURCE: src/app/dashboard/users/page.tsx:40-45 (PR#32) —— 门禁将从 student:['list'] 改为 admin+
const ctx = await requireAuthContext()
requirePermission(ctx, { student: ['list'] })              // ← 改:见 Task D1
const canManageUsers = can(ctx.role, { member: ['create'] })
const { tab: rawTab } = await searchParams                 // Next 16:searchParams 是 Promise,必须 await
const tab = rawTab === 'parents' && canManageUsers ? 'parents' : 'students'
```

### 迁移脚本骨架(seed-admin 的 postgres/advisory-lock/退出码 参照)
```typescript
// SOURCE: scripts/migrate.ts —— seed-admin 复用「advisory-lock 串行 + 非零退出即中止」
const sql = postgres(url, { max: 1, onnotice: () => {} })
await sql`SELECT pg_advisory_lock(${LOCK_KEY})`
try { /* 幂等操作 */ } finally { await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`; await sql.end({ timeout: 5 }) }
```

### esbuild 运行时打包(Dockerfile;seed-admin.mjs 照抄 + 追加 `--conditions=react-server`)
```dockerfile
# SOURCE: Dockerfile:47-53 (migrate.mjs)
RUN node_modules/.bin/esbuild scripts/migrate.ts \
      --bundle --platform=node --format=esm --target=node24 \
      --banner:js="import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" \
      --external:cloudflare:sockets --outfile=dist/migrate.mjs
```

### RBAC 纯函数单测(分级矩阵照抄)
```typescript
// SOURCE: tests/rbac-reschedule.test.ts:26-32
it('owner/admin can create members; parent/student cannot', () => {
  expect(can('owner', { member: ['create'] })).toBe(true)
  expect(can('admin', { member: ['create'] })).toBe(true)
  expect(can('parent', { member: ['create'] })).toBe(false)
})
```

### DB 集成测试(建号/绑定/解绑;staff 测试照抄)
```typescript
// SOURCE: tests/portal-admin.test.ts:22-27, 93-109
const ctxFor = (tenantId, userId, role = 'owner'): AuthContext => ({ tenantId, userId, role, isPlatformAdmin: false })
it('createPortalUserCore mints one membership, zero links', async () => {
  const r = await createPortalUserCore(ownerCtx(), { name: '家长', kind: 'parent', password: 'portal-password-123' })
  const mems = await db.select().from(member).where(eq(member.userId, r.userId))
  expect(mems).toHaveLength(1); expect(mems[0].role).toBe('parent')
})
```

---

## Files to Change

### 工作流 A — 修 PR#32 MEDIUM(Small)
| File | Action | Justification |
|---|---|---|
| `src/auth/provision.ts` | UPDATE | `createPortalUserCore` 回传 `created` 标志 |
| `src/app/dashboard/users/user-actions.ts` | UPDATE | `CreateUserResult` 增 `created`,透传 |
| `src/app/dashboard/users/user-form.tsx` | UPDATE | `created===false` 时改文案(不再宣称已设新密码) |
| `tests/portal-admin.test.ts` | UPDATE | 补「同邮箱重复建号 → created=false」用例 |

### 工作流 B — 禁用自助注册(Small)
| File | Action | Justification |
|---|---|---|
| `src/auth/auth.ts` | UPDATE | `emailAndPassword: { enabled: true, disableSignUp: true }` |
| `src/app/(auth)/signup/page.tsx` | UPDATE | 改为 `redirect('/login')`(保留路由防 404,或直接删目录) |
| `src/app/(auth)/login/page.tsx` | UPDATE | 删「还没有账号？注册」链接 |
| `tests/e2e/**` | UPDATE | 删/改任何走 `/signup` 的 e2e(实施前 grep `signup`) |

### 工作流 C — env 播种默认超管(Medium)
| File | Action | Justification |
|---|---|---|
| `scripts/seed-admin.ts` | CREATE | 幂等播种「默认机构 + owner member + user.role=superadmin」 |
| `src/env.ts` | UPDATE | 新增 `ADMIN_EMAIL/ADMIN_PASSWORD/ADMIN_NAME/DEFAULT_ORG_NAME/DEFAULT_ORG_ID` |
| `docker/entrypoint.sh` | UPDATE | migrate 后、启动前插 `node /app/dist/seed-admin.mjs` |
| `Dockerfile` | UPDATE | 新增 esbuild 打包 `seed-admin.mjs`(+`--conditions=react-server`) |
| `docker-compose.yml` | UPDATE | app.environment 注入 ADMIN_*(runtime 不读 .env) |
| `.env.example` / `.env.e2e.example` | UPDATE | 记录 ADMIN_* |
| `package.json` | UPDATE | 加 `db:seed:admin`(本地 tsx) |
| `tests/seed-admin.test.ts` | CREATE | 幂等性 + 角色正确性 DB 集成测试 |

### 工作流 D — 账号管理 RBAC + staff 管理(Large)
| File | Action | Justification |
|---|---|---|
| `src/auth/staff.ts` | CREATE | `createStaffUserCore/setStaffRoleCore/deactivateStaffCore/reactivateStaffCore` |
| `src/auth/staff-authz.ts` | CREATE | `isSuperAdmin/assertCanManageRole`(分级支点) |
| `src/app/dashboard/users/data.ts` | UPDATE | `listStaff(ctx)`(member 直查,取 staff 角色,带 banned) |
| `src/app/dashboard/users/page.tsx` | UPDATE | 门禁改 admin+;加 教师/管理员 Tab |
| `src/app/dashboard/users/staff-actions.ts` | CREATE | staff 五步范式 Server Actions |
| `src/app/dashboard/users/teachers-tab.tsx` | CREATE | 教师账号管理 |
| `src/app/dashboard/users/admins-tab.tsx` | CREATE | 管理员列表;写控件仅 `isSuperAdmin` |
| `src/app/dashboard/users/staff-form.tsx` | CREATE | 建 staff 表单(kind=teacher/admin) |
| `src/app/dashboard/students/page.tsx` | UPDATE | redirect 目标随门禁收紧(admin+ 才可达) |
| `src/app/dashboard/_nav/nav-links.tsx` | UPDATE | 「用户管理」按 `canManageUsers` 条件渲染 |
| `src/app/dashboard/layout.tsx` | UPDATE | 计算 `canManageUsers` 传 NavLinks |
| `tests/staff-admin.test.ts` | CREATE | staff 核心 DB 集成测试 |
| `tests/rbac-staff.test.ts` | CREATE | 分级 `assertCanManageRole` 纯函数矩阵 |
| `tests/e2e/dashboard/users.spec.ts` | UPDATE | 教师 302、四 Tab、超管/普管写权限差异 |

### 工作流 E — 教师本班收敛(Large,横切;建议独立 PR)
| File | Action | Justification |
|---|---|---|
| `src/auth/scope.ts` | CREATE | `sectionIdsForActor(ctx)`:teacher→本人 section;其余→全部 |
| `src/app/dashboard/courses/actions.ts` | UPDATE | `listSections` 按 actor 收敛 |
| `src/app/dashboard/schedule/page.tsx` + `data.ts` | UPDATE | 课表 section/lesson 按 actor 收敛 |
| `src/app/dashboard/students/actions.ts` | UPDATE | `listStudents` 对 teacher 按 enrollment 收敛 |
| `src/app/dashboard/teach/[sectionId]/tabs/students-panel.tsx` | UPDATE | 选择器学生源收敛 |
| `src/app/dashboard/reports/**`、`calendar/**` | UPDATE | 教师面数据收敛(实施前 grep 全量 `listSections/listStudents` 调用点) |
| `tests/rbac-teacher-scope.test.ts` | CREATE | 教师只见本班 section/student 的集成断言 |

## NOT Building
- **历史多租户数据迁移**(决策3:全新单机构;不写迁移脚本)。
- **自助密码找回/邮箱验证**(现 `requireEmailVerification:false`,无 `sendResetPassword`)。初始密码由 admin 设定并转交;如需「用户自助改密」列为后续。
- **邀请制注册 / 组织自服务**(organization 插件的 invite 面不启用)。
- **多机构切换 UI**(单租户;不做机构选择器)。
- **删除(硬删)账号**:统一用「停用」(ban),不做物理删(保留 attendance/grade 外键完整)。
- **schema 变更**:不新增列/表(复用 user/member/portalLink;`user.banned` 已存在)→ **无 drizzle migration**。

---

## Step-by-Step Tasks

### 工作流 A — 修 PR#32 MEDIUM

#### Task A1: `createPortalUserCore` 回传 `created`
- **ACTION**: 改 `src/auth/provision.ts` 的 `createPortalUserCore`。
- **IMPLEMENT**: `provisionPortalMember` 已返回 `{ userId, created }`;把 `created` 透出:返回类型改 `Promise<{ userId: string; email: string; created: boolean }>`,`const { userId, created } = await provisionPortalMember(...)`,`return { userId, email, created }`。
- **MIRROR**: HEADLESS_CORE。
- **GOTCHA**: 不要在此抛错——留给 UI 决定文案(用户仍可能想接着「关联」这个既有账号);**外组邮箱**仍由 `provisionPortalMember` 抛 `'该邮箱已被其他账号占用'`,行为不变。
- **VALIDATE**: `tsc --noEmit`;A4 用例。

#### Task A2: Server Action 透传 `created`
- **ACTION**: 改 `src/app/dashboard/users/user-actions.ts`。
- **IMPLEMENT**: `CreateUserResult = { ok: true; userId: string; email: string; created: boolean } | { ok: false; error: string }`;`createPortalUser` 里 `return { ok: true, ...res }`(res 已含 created)。
- **MIRROR**: SERVER_ACTION_五步范式。
- **VALIDATE**: `tsc`。

#### Task A3: UI 文案区分
- **ACTION**: 改 `src/app/dashboard/users/user-form.tsx`(状态 `email` 处附带 `created`)。
- **IMPLEMENT**: 存 `res.created`;`created===true` → 「已新建！登录邮箱:… (请连同密码转交)」;`created===false` → 「该邮箱已是本机构账号,**未新建、密码未改**;如需关联请用下方"关联学生"」。
- **GOTCHA**: `user-form.tsx:91-95` 的绿色成功块无条件宣称「已新建」——正是 MEDIUM 的误导源;必须按 `created` 分支。
- **VALIDATE**: 手测 + e2e。

#### Task A4: 回归用例
- **ACTION**: 改 `tests/portal-admin.test.ts`,补一例。
- **IMPLEMENT**: 用同一 `loginId`(真实邮箱)连续 `createPortalUserCore` 两次:第 2 次 `expect(r2.created).toBe(false)` 且 `member` 仍仅 1 行、角色不被改写。
- **MIRROR**: DB 集成测试。
- **VALIDATE**: `npm run test`(需实时 DB)。

### 工作流 B — 禁用自助注册

#### Task B1: 服务端关闭注册
- **ACTION**: 改 `src/auth/auth.ts:15`。
- **IMPLEMENT**: `emailAndPassword: { enabled: true, requireEmailVerification: false, disableSignUp: true }`。
- **IMPORTS**: 无新增。
- **GOTCHA**: `disableSignUp` 只拦 `/sign-up/email`;`auth.api.createUser`(`/admin/create-user`)不受影响——seed-admin 与 staff 建号照常。**验证** `disableSignUp` 在装机版 `@better-auth/core .../init-options.ts` 的 `emailAndPassword` 块存在(已确认 1.7.4 有)。
- **VALIDATE**: 起服务,`curl -X POST /api/auth/sign-up/email` 应返回禁用错误。

#### Task B2: 删注册页 + 链接
- **ACTION**: 改 `src/app/(auth)/signup/page.tsx` 为 `import { redirect } from 'next/navigation'; export default function SignupPage(){ redirect('/login') }`;删 `login/page.tsx:63-68` 的注册链接段落。
- **MIRROR**: `src/app/dashboard/students/page.tsx`(redirect 范式)。
- **GOTCHA**: 保留路由文件用 redirect,避免历史书签 404;也可直接删 `(auth)/signup/` 目录(二选一,redirect 更稳)。
- **VALIDATE**: 访问 `/signup` → 落 `/login`;`/login` 无注册链接。

#### Task B3: e2e 清理
- **ACTION**: 实施前 `grep -rn "signup\|sign-up\|注册" tests/e2e`,删/改相关断言。
- **VALIDATE**: `npm run test:e2e`(或至少 smoke)。

### 工作流 C — env 播种默认超管

#### Task C1: env 变量
- **ACTION**: 改 `src/env.ts` server 块。
- **IMPLEMENT**:
  ```ts
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  ADMIN_NAME: z.string().min(1).default('管理员'),
  DEFAULT_ORG_NAME: z.string().min(1).default('默认机构'),
  DEFAULT_ORG_ID: z.string().min(1).default('org_default'),
  ```
- **GOTCHA**: 全 optional(无 ADMIN_* 时应用仍能启动,seed 跳过并告警);`skipValidation`(build 期)不套用 default——但 seed-admin 在 runtime 跑,default 生效。
- **VALIDATE**: `tsc`;`npm run build`(SKIP_ENV_VALIDATION=1 仍过)。

#### Task C2: seed-admin 脚本
- **ACTION**: 新建 `scripts/seed-admin.ts`。
- **IMPLEMENT**(幂等,child→parent 顺序无关,全 upsert):
  1. `import { env } from '@/env'`;若 `!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD` → `console.warn('[seed-admin] no ADMIN_EMAIL/PASSWORD, skip'); process.exit(0)`。
  2. upsert 默认机构:`db.insert(organization).values({ id: env.DEFAULT_ORG_ID, name: env.DEFAULT_ORG_NAME, slug: 'default', createdAt: new Date() }).onConflictDoNothing()`。
  3. 查 `user` by `ADMIN_EMAIL`;不存在 → `await auth.api.createUser({ body: { email, password: ADMIN_PASSWORD, name: ADMIN_NAME } })`;拿 `userId`。
  4. `db.update(user).set({ role: 'superadmin' }).where(eq(user.id, userId))`(平台 superadmin;直接写 DB,mirror seed-e2e 的直写)。
  5. upsert owner member:查 `(userId, DEFAULT_ORG_ID)` member;无则 `auth.api.addMember({ body: { userId, role: 'owner', organizationId: DEFAULT_ORG_ID } })`(或直插 member 行,mirror createStaff)。
  6. `console.log('[seed-admin] done')`;`process.exit(0)`;catch → 打错并 `exit(1)`。
- **MIRROR**: STAFF_CREATE_范式 + 迁移脚本骨架;顶部 `import 'server-only'` **不加**(脚本无需;且会在 Node 抛)。
- **IMPORTS**: `{ auth } from '@/auth/auth'`、`{ db } from '@/db'`、`{ user, member, organization } from '@/db/schema'`、`{ env } from '@/env'`、`{ eq, and } from 'drizzle-orm'`。
- **GOTCHA**:
  - **createUser 会触发 `user.create.after` 钩子**,但钩子 `if (context?.path !== '/sign-up/email') return`——`createUser` 走 `/admin/create-user`,**不会自建机构**;故必须显式 addMember。
  - **幂等**:重复部署不得重建/改密——步骤 3 先查存在即跳过 createUser(密码不变);步骤 4/5 用 upsert/存在性检查。
  - **单进程串行**:若多副本同时启动,用 `pg_advisory_lock`(mirror migrate.ts)包住,避免并发建重。
- **VALIDATE**: 本地 `npm run db:seed:admin` 跑两遍,第二遍全 no-op;`user.role='superadmin'` 且有 owner member。

#### Task C3: package.json 脚本
- **ACTION**: 加 `"db:seed:admin": "node --conditions=react-server --import tsx scripts/seed-admin.ts"`。
- **MIRROR**: `db:seed:e2e`(注意 `--conditions=react-server` 让 `server-only` 解析为空)。
- **VALIDATE**: 本地跑通。

#### Task C4: Dockerfile 打包 + entrypoint 钩子
- **ACTION**: 改 `Dockerfile`(build 阶段)与 `docker/entrypoint.sh`。
- **IMPLEMENT**:
  - Dockerfile 追加(紧邻 migrate.mjs 那条 esbuild):
    ```dockerfile
    RUN node_modules/.bin/esbuild scripts/seed-admin.ts \
          --bundle --platform=node --format=esm --target=node24 --conditions=react-server \
          --banner:js="import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" \
          --external:cloudflare:sockets --outfile=dist/seed-admin.mjs
    ```
    并在 runtime 阶段 `COPY --from=build .../dist/seed-admin.mjs ./dist/seed-admin.mjs`。
  - entrypoint 在 migrate 后、`exec node /app/server.js` 前插:
    ```sh
    echo "[entrypoint] seeding default admin (idempotent)"
    node /app/dist/seed-admin.mjs
    ```
- **GOTCHA**:
  - **`--conditions=react-server` 是关键**:seed-admin 经 `@/auth/auth`→`@/db`→`@/db/tenant`(`import 'server-only'`)会拉入 server-only,打包/Node 下会抛;该条件把它解析为空模块。migrate.mjs 不需要(不 import server-only)。
  - **better-auth 动态 require**:banner 的 `createRequire` 已覆盖;若 esbuild 报 "Dynamic require",按需追加 `--external:` 或 `--packages=external` 变体(见 Risks)。
  - **seed 失败是否阻断启动**:建议 `node dist/seed-admin.mjs || echo "[entrypoint] seed-admin failed (continuing)"`?否——首次部署失败应可见;但已存在超管时失败不应挡服务。折中:seed 内部对「已存在超管」永远成功退出,仅真错误 exit(1);entrypoint **不**吞错(与 migrate 一致,非零即中止),避免半初始化对外服务。
- **VALIDATE**: `docker compose build && docker compose up`;首启日志见 seed done;二启 no-op;用 ADMIN_EMAIL 登录落 `/dashboard`。

#### Task C5: compose/env 样例
- **ACTION**: `docker-compose.yml` app.environment 加 `ADMIN_EMAIL/ADMIN_PASSWORD/ADMIN_NAME/DEFAULT_ORG_NAME/DEFAULT_ORG_ID`(`${ADMIN_EMAIL:?set ADMIN_EMAIL in .env}` 强制首部署提供,或留空默认由 seed 跳过并告警——推荐前者以防「注册已禁、无人可登」死锁);`.env.example` 记录之。
- **GOTCHA**: **runtime standalone 不读 .env**(见 compose 现有 P8 注释)——必须走 environment 注入。
- **VALIDATE**: `docker compose config` 展开正确。

### 工作流 D — 账号管理 RBAC + staff 管理

#### Task D0: 分级授权助手
- **ACTION**: 新建 `src/auth/staff-authz.ts`。
- **IMPLEMENT**:
  ```ts
  import 'server-only'
  import { AuthError, type AuthContext } from '@/auth/context'
  import { requirePermission } from '@/auth/authorize'
  export const STAFF_ROLES = ['owner', 'admin', 'teacher', 'assistant'] as const
  export function isSuperAdmin(ctx: AuthContext): boolean { return ctx.isPlatformAdmin }
  // 管理某目标角色的账号:admin/owner → 仅超管;其余(teacher/assistant/parent/student) → owner/admin
  export function assertCanManageRole(ctx: AuthContext, targetRole: string): void {
    const roles = targetRole.split(',').map((r) => r.trim())
    const touchesAdmin = roles.some((r) => r === 'admin' || r === 'owner')
    if (touchesAdmin) { if (!isSuperAdmin(ctx)) throw new AuthError('FORBIDDEN'); return }
    requirePermission(ctx, { member: ['create'] })
  }
  ```
- **MIRROR**: AUTHZ_BYPASS。
- **GOTCHA**: 改角色时须对**旧角色与新角色都** `assertCanManageRole`(防普通 admin 把 teacher 提升成 admin,或碰任何 admin 目标)。
- **VALIDATE**: `tsc`;D6 矩阵测试。

#### Task D1: 页级门禁收紧 + 4 Tab
- **ACTION**: 改 `src/app/dashboard/users/page.tsx`。
- **IMPLEMENT**: 门禁 `if (!(can(ctx.role, { member: ['create'] }) || ctx.isPlatformAdmin)) redirect('/dashboard')`(teacher/assistant 被踢);`searchParams.tab ∈ {students,parents,teachers,admins}`;渲染 4 个 TabLink;`const isSuper = isSuperAdmin(ctx)` 传给 admins-tab 控制写控件。
- **MIRROR**: 页级三层纵深门禁。
- **GOTCHA**: Next 16 `searchParams` 是 Promise,必须 `await`;非法 tab 回落 students。
- **VALIDATE**: teacher 访问 302;admin 见 4 Tab。

#### Task D2: `listStaff` 数据层
- **ACTION**: 改 `src/app/dashboard/users/data.ts`,加 `listStaff(ctx)`。
- **IMPLEMENT**: member innerJoin user,`eq(member.organizationId, ctx.tenantId)`,过滤 `STAFF_ROLES`(排除 portal 角色),select `banned`;返回 `{ userId, name, email, role, banned }[]`。
- **MIRROR**: 门户账号列举(取反:staff 而非 portal)。
- **GOTCHA**: `member.role` 可逗号多角色 → JS 过滤(`!isPortalRole(role)` 即 staff)。
- **VALIDATE**: 集成测试。

#### Task D3: staff 核心 + Server Actions
- **ACTION**: 新建 `src/auth/staff.ts` + `src/app/dashboard/users/staff-actions.ts`。
- **IMPLEMENT(staff.ts)**:
  - `createStaffUserCore(ctx, { name, email, password, role })`:`assertCanManageRole(ctx, role)`;email 存在且属本组 → 抛「该邮箱已是本机构账号」(不静默复用,吸取 A 的教训);否则 `auth.api.createUser` + `auth.api.addMember({ role })`,addMember 失败补偿 `deprovisionPortalMember`。
  - `setStaffRoleCore(ctx, targetUserId, newRole)`:读旧 member 角色;`assertCanManageRole(ctx, oldRole)` **且** `assertCanManageRole(ctx, newRole)`;`auth.api.updateMemberRole` 或直改 member.role;禁止把最后一个 owner 降级(见 GOTCHA)。
  - `deactivateStaffCore(ctx, targetUserId)` / `reactivateStaffCore`:读目标 member 角色 → `assertCanManageRole`;`auth.api.banUser({ body:{ userId } })` / `unbanUser`。
- **IMPLEMENT(staff-actions.ts)**: 五步范式,业务错误当 DATA 返回,`revalidatePath('/dashboard/users')`。
- **MIRROR**: HEADLESS_CORE + STAFF_CREATE_范式 + SERVER_ACTION_五步范式。
- **GOTCHA**:
  - **自我降级/自停用防护**:禁止用户停用/降级自己(`targetUserId===ctx.userId` 拒);禁止停用/降级**最后一个 owner/超管**(先 count)。
  - **跨租户**:targetUserId 必须先校验属本 org(mirror `linkPortalUserCore` 的 member 存在性检查)。
  - **停用即时生效**:`getAuthContext` 已 `disableCookieCache`,ban 后目标下次请求即失权。
- **VALIDATE**: D5 集成测试。

#### Task D4: UI(teachers-tab / admins-tab / staff-form)
- **ACTION**: 新建三个组件。
- **IMPLEMENT**:
  - `teachers-tab.tsx`:`requireAuthContext` + `requirePermission({member:['create']})`;列 teacher(+assistant?),提供 建/改角色/停用 控件(全 admin+ 可用)。
  - `admins-tab.tsx`:同 ctx;列 owner/admin;**写控件仅 `isSuperAdmin(ctx)` 渲染**,普通 admin 只读(与需求「只读 admin」一致)。
  - `staff-form.tsx`:客户端表单,kind=teacher|admin(admin 选项仅超管可见),name/email/password。
- **MIRROR**: `parents-tab.tsx`/`user-form.tsx`(PR#32)。
- **GOTCHA**: 组件级**重新** `requirePermission` + 对 admin 操作再 `assertCanManageRole`(纵深防御:直连 action 也拦);多角色 `member.role` 显示做映射(避免露出逗号原文——顺带修 PR#32 LOW#4)。
- **VALIDATE**: e2e 权限差异。

#### Task D5: staff 集成测试
- **ACTION**: 新建 `tests/staff-admin.test.ts`。
- **IMPLEMENT**: 建 teacher(admin ctx 可)/建 admin(仅超管 ctx 可,admin ctx 抛 FORBIDDEN)/停用 teacher(admin 可)/停用/改 admin(admin ctx 抛,超管 ctx 可)/最后一个 owner 不可降/不可自停。
- **MIRROR**: DB 集成测试。
- **VALIDATE**: `npm run test`。

#### Task D6: 分级 RBAC 纯函数矩阵
- **ACTION**: 新建 `tests/rbac-staff.test.ts`。
- **IMPLEMENT**: 用 `ctxFor` 构造 super(isPlatformAdmin:true) / admin / teacher;断言 `assertCanManageRole`:admin→admin 目标抛、super→admin 目标过;admin→teacher 过、teacher→teacher 目标抛(teacher 无 member:create)。
- **MIRROR**: RBAC 纯函数单测。
- **VALIDATE**: `npm run test`(纯函数,无需 DB)。

#### Task D7: 导航条件渲染
- **ACTION**: 改 `src/app/dashboard/layout.tsx` + `_nav/nav-links.tsx`。
- **IMPLEMENT**: layout 里 `const canManageUsers = can(ctx.role, { member:['create'] }) || ctx.isPlatformAdmin`;`<NavLinks canManageUsers={canManageUsers} />`;NavLinks 收 prop,`{canManageUsers && <NavLink href="/dashboard/users">用户管理</NavLink>}`。
- **GOTCHA**: NavLinks 是 client 组件、无 ctx——必须从 server layout 传 prop;`/dashboard/students` 旧链接(若还在 nav)一并去掉或指向 users。
- **VALIDATE**: teacher 登录无「用户管理」项。

### 工作流 E — 教师本班收敛(横切,建议独立 PR)

#### Task E1: actor 作用域助手
- **ACTION**: 新建 `src/auth/scope.ts`。
- **IMPLEMENT**: `async function sectionIdsForActor(ctx): Promise<string[] | 'all'>`:`can(ctx.role,{course:['list']}) && !isPortalRole && ctx.role!=='teacher'` 之外——精确:owner/admin/assistant/超管 → `'all'`;teacher → `forTenant(ctx).select(classSection, eq(classSection.teacherId, ctx.userId))` 的 id 列表。
- **GOTCHA**: `classSection.teacherId` 存的是**教师 user id**(seed-e2e 佐证:`teacherId = createStaff(...)` 的 user.id)。
- **VALIDATE**: 集成测试。

#### Task E2–E5: 贯穿教学面
- **ACTION**: 把 `sectionIdsForActor` 织入 `listSections`(courses/actions)、`SchedulePage`+`schedule/data`(lesson 按 section 收敛)、`students-panel` 选择器、reports/calendar。teacher 的 `listStudents` 改为「仅本人 section 的 active enrollment 对应学生」。
- **IMPLEMENT**: 助手返回 `'all'` 时保持原查询;否则 `inArray(classSection.id, ids)` / 学生 `inArray(student.id, enrolledIds)`。
- **GOTCHA**: 实施前 `grep -rn "listSections\|listStudents\|forTenant(ctx).select(classSection" src/app/dashboard` 枚举**全部**调用点,逐一评估是否属教师面;**门户 `/portal` 不受影响**(已由 portalLink 收敛)。
- **VALIDATE**: E6。

#### Task E6: 教师作用域集成测试
- **ACTION**: 新建 `tests/rbac-teacher-scope.test.ts`。
- **IMPLEMENT**: 建 2 teacher + 各自 section + 学生;断言 teacherA 的 `listStudents/sectionIdsForActor` 只见 A 的 section/学生,不见 B 的;owner 见全部。
- **VALIDATE**: `npm run test`。

---

## 实施顺序与 PR 拆分
1. **PR-1(A+B+C)**:修 MEDIUM + 禁注册 + env 播种超管。这是「可部署上线」的最小闭环(禁注册后必须有 env 超管,否则无人可登——A/B/C 必须同 PR)。
2. **PR-2(D)**:账号管理四 Tab + 分级 RBAC + staff 管理。依赖 PR#32 已合并 + PR-1 的超管。
3. **PR-3(E)**:教师本班收敛(横切,单独 PR 便于审查数据作用域回归)。
- **前置**:PR#32(`/dashboard/users`)需先合并入 main;否则 D 无基线(A 也需在 PR#32 代码上改)。

---

## Testing Strategy

### Unit / 集成 Tests
| Test | Input | Expected | Edge? |
|---|---|---|---|
| A4 同邮箱重复建号 | 同 loginId 建 2 次 | 2nd `created=false`,member 仍 1 行,角色不改 | ✓ |
| D6 admin 管 admin | `assertCanManageRole(adminCtx,'admin')` | throw FORBIDDEN | ✓ |
| D6 super 管 admin | `assertCanManageRole(superCtx,'admin')` | 通过 | |
| D6 admin 管 teacher | `assertCanManageRole(adminCtx,'teacher')` | 通过 | |
| D5 admin 建 admin | createStaffUserCore(adminCtx, role=admin) | throw | ✓ |
| D5 最后 owner 降级 | setStaffRoleCore 降唯一 owner | throw | ✓ |
| D5 自停用 | deactivateStaffCore(ctx, ctx.userId) | throw | ✓ |
| C seed 幂等 | seed-admin 跑 2 遍 | 2nd 全 no-op;role=superadmin;owner member 唯一 | ✓ |
| E6 教师作用域 | teacherA listStudents | 仅 A 的 section 学生 | ✓ |

### Edge Cases Checklist
- [ ] 无 ADMIN_* env → seed 跳过 + 告警(应用仍启动)
- [ ] disableSignUp 后 `auth.api.createUser` 仍可用(staff/seed 建号)
- [ ] 停用后目标下次请求即失权(cookieCache 已禁)
- [ ] 逗号多角色 `member.role` 在 listStaff/listPortalUsers/展示映射均正确
- [ ] 普通 admin 直连 staff-action 改 admin(绕过 UI)被 `assertCanManageRole` 拦(纵深)
- [ ] 教师直连 `/dashboard/users?tab=admins` 被页级 302
- [ ] 并发多副本启动 seed(advisory-lock 串行)

---

## Validation Commands
```bash
npm run typecheck        # EXPECT: 0 error
npm run lint             # EXPECT: 0 warning
npm run test             # EXPECT: 全绿(含新增 A4/C/D5/D6/E6;集成用例需实时 DB)
npm run build            # EXPECT: 成功;/dashboard/users 生成;/signup 为 redirect
# 部署链:
docker compose build && ADMIN_EMAIL=... ADMIN_PASSWORD=... docker compose up -d
docker compose logs app | grep seed-admin   # EXPECT: done(二启 no-op)
curl -s -X POST "$URL/api/auth/sign-up/email" -d '{...}'   # EXPECT: 禁用错误
```
### Manual Validation
- [ ] `/signup`→`/login`;`/login` 无注册链接
- [ ] ADMIN_EMAIL 登录 → `/dashboard`;顶部有「用户管理」
- [ ] teacher 登录 → 无「用户管理」;直访 `/dashboard/users` 被 302
- [ ] 普通 admin:可建/停用 teacher/parent/student;管理员 Tab 只读
- [ ] 超管:管理员 Tab 可建/改/停用 admin
- [ ] teacher 排课/教务工作台仅见本班学生(工作流 E 后)

---

## Acceptance Criteria
- [ ] `/signup` 双层禁用(UI redirect + 服务端 disableSignUp)
- [ ] env 播种幂等产出「默认机构 + owner + superadmin」,首/二次部署均正确
- [ ] `/dashboard/users` 仅 owner/admin/超管可见;四 Tab
- [ ] 普通 admin 管 student/parent/teacher(含停用),对 admin 只读
- [ ] 仅超管可建/改/停用 admin
- [ ] PR#32 MEDIUM 修复(建号复用不再谎报「已新建」)
- [ ] 教师仅见本班学生
- [ ] 全部 validation 命令通过;无 schema 迁移

## Completion Checklist
- [ ] 遵循五步范式/HEADLESS_CORE/AUTHZ_BYPASS 既有模式
- [ ] 中文业务错误当 DATA 返回(避开 Next 生产 redaction)
- [ ] 纵深防御:page→组件→action 三层;action 层对 admin 目标再 `assertCanManageRole`
- [ ] 无硬编码机构/角色字面量散落(集中在 permissions/staff-authz)
- [ ] 测试覆盖分级矩阵 + 幂等 + 作用域 + 自我保护
- [ ] `.env.example`/compose/Dockerfile/entrypoint 同步

## Risks
| Risk | 概率 | 影响 | 缓解 |
|---|---|---|---|
| esbuild 打 better-auth 报 "Dynamic require" | 中 | seed-admin.mjs 运行时崩 | banner 已加 createRequire;必要时 `--packages=external` + runtime 保留 node_modules 子集(mirror playwright 的 COPY 做法),或改用「build 阶段一次性 seed 服务」(mirror compose 的 `test` 服务 `target: build`) |
| 禁注册但漏配 ADMIN_* → 无人可登(死锁) | 中 | 部署不可用 | compose 用 `${ADMIN_EMAIL:?...}` 强制首部署提供;seed 无 env 时**显式告警** |
| `disableSignUp` 在装机版名称/行为不符预期 | 低 | 注册未真正关 | 已核对 1.7.4 类型存在;兜底:`emailAndPassword` 加 `before` 钩子在 `/sign-up/email` 抛,或删路由 + 前端移除 |
| 工作流 E 漏收敛某教学面 → 教师越权看他班 | 中 | 数据越权 | 实施前 grep 全量调用点;E6 集成断言;E 独立 PR 便于审查 |
| PR#32 未合并 → D/A 无基线 | 高 | 阻塞 | 前置:先合 PR#32;或在其分支上迭代 |
| 改 `user.role` 直写 vs `auth.api.setRole` 语义差异 | 低 | 平台角色不生效 | `getAuthContext` 读 `session.user.role`——直写 user.role 后需确保会话重建(登录时刷新);seed 在无会话期跑,登录时自然带上 |

## Notes
- **两套 AC 宇宙**是全局关键:组织角色管租户内业务,平台 `superadmin` 管跨租户 + `requirePermission` 绕过——「默认超管」= 二者兼具(owner + superadmin)。
- **单租户假设**贯穿:所有账号都在 `DEFAULT_ORG_ID` 机构;`forTenant(ctx)` 仍是唯一租户写路径(即便单租户也不裸查)。
- **无 migration**:复用现有 user/member/portalLink 表与 `user.banned` 列。
- PR#32 的 LOW#2/#3/#4(N+1、无界拉取、逗号角色展示)非本计划目标;LOW#4 顺手在 D4 展示映射里修。
- **停用 vs 删除**:统一 ban(可逆、保外键);不物理删账号。
