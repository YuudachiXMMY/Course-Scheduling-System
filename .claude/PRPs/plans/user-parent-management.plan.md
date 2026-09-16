# Plan: 用户管理页面 — 学生/家长统一管理与关联

## Summary
新建 `/dashboard/users` 用户管理页,以「学生 / 家长」两个 Tab 承载。学生列表由现 `/dashboard/students` 迁入(旧路由 302 重定向),新增家长管理:列出机构内所有门户账号(parent/student)及其关联学生,支持新建账号,并在**学生↔账号**两个方向上独立地关联(assign)/解绑。家长在数据层**即门户登录账号**(Better Auth `member` role='parent' + `portalLink`),完全复用现有 provision/portalLink 机制,**无新表、无数据迁移**。

## User Story
As a 机构 owner/admin(教务管理者),
I want 在一个「用户管理」页里集中管理学生与家长账号,并能把已有家长关联到多个学生(或反向),
So that 不必在开通登录时被迫一次性绑定,能灵活维护「一个家长 ↔ 多个孩子」的关系。

## Problem → Solution
**现状**:学生列表在独立的 `/dashboard/students`;家长仅以 ① student 表反规范化字段、② 门户账号(`portalLink`)两种形式存在;`portalLink` 只能在「开通登录」(`provisionPortalAccountCore`,强制带 `studentId`)时顺带创建,**没有**独立的「把已有账号关联/解绑到某学生」的动作,也**没有**集中查看家长账号的入口。
**目标**:统一的 `/dashboard/users` 页(学生/家长 Tab);家长管理视图;独立、幂等的 link/unlink 动作,可双向 assign;新建门户账号可不立即绑定学生。

## Metadata
- **Complexity**: Medium(约 10-13 文件,含 2 个测试文件;复用现有 auth/tenant/provision 机制,无 schema 变更)
- **Source PRD**: N/A(自由描述)
- **PRD Phase**: N/A
- **Estimated Files**: 新建 ~8,修改 ~5

---

## UX Design

### Before
```
顶栏导航:  排课  |  学生  |  [教务工作台 · 课程 · 报告]  |  改期申请  |  日历订阅

/dashboard/students
┌───────────────────────────────────────────┐
│ 学生                                        │
│ [＋添加学生表单]                            │
│ 在读学生（N）                               │
│   · 甲   初二 · 微信 wx1      [编辑]        │
│       [分享面板] [开通登录]                 │  ← 「开通登录」是唯一能建 portalLink 的入口
│ 已归档（M） …                               │
└───────────────────────────────────────────┘
家长:无集中管理入口;只能在某个学生下「开通登录」。
```

### After
```
顶栏导航:  排课  |  用户管理  |  [教务工作台 · 课程 · 报告]  |  改期申请  |  日历订阅
                     └── /dashboard/users(旧 /dashboard/students 302→ 此页 ?tab=students)

/dashboard/users?tab=students
┌───────────────────────────────────────────┐
│ 用户管理     [ 学生 ]  [ 家长 ]  ← Tab 栏   │
│ ── 学生 Tab(= 原学生页,原样迁入)──        │
│ 学生                                        │
│ [＋添加学生]                                │
│ 在读学生（N）                               │
│   · 甲   初二 · 微信 wx1      [编辑]        │
│       [分享面板] [开通登录]                 │
│       关联账号:家长-李（parent）[解绑]      │  ← 新增:显示已关联账号 + 关联家长
│       [＋关联家长/学生 ▾]                   │
└───────────────────────────────────────────┘

/dashboard/users?tab=parents  (仅 owner/admin 可见)
┌───────────────────────────────────────────┐
│ 用户管理     [ 学生 ]  [ 家长 ]             │
│ ── 家长 Tab ──                              │
│ [＋新建用户(家长/学生)]                     │  ← 可不绑定学生直接建账号
│ 门户账号（K）                               │
│   · 家长-李  parent  li@x.com               │
│       关联学生:甲 [解绑]  乙 [解绑]         │
│       [＋关联学生 ▾]                        │  ← 把学生 assign 到该家长
│   · 学生本人-甲  student  portal_x@…        │
│       关联学生:甲 [解绑]                    │
└───────────────────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| 顶栏「学生」链接 | → `/dashboard/students` | 替换为「用户管理」→ `/dashboard/users` | smoke.spec 导航断言需同步 |
| `/dashboard/students` | 学生页 | 302 → `/dashboard/users?tab=students` | 保留旧书签/链接 |
| 家长集中管理 | 无 | `?tab=parents`,列出所有门户账号 | 仅 owner/admin |
| 关联家长↔学生 | 只能「开通登录」时绑定 | 独立 [关联]/[解绑],学生页与家长页双向可用 | 幂等 link/unlink |
| 新建门户账号 | 必须选定一个学生 | 家长页可不绑学生直接建 | 建后再 assign |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/auth/provision.ts` | 全 | link/create 核心复用 `provisionPortalMember`;镜像其幂等/防跨租户/补偿模式 |
| P0 | `src/auth/portal.ts` | 全 | `isPortalRole`(多角色逗号串解析)、`portalLink` 查询与 `resolveLinkedStudentIds` 反查模式 |
| P0 | `src/db/tenant.ts` | 全 | `forTenant(ctx)` 是租户表**唯一**合法读写通道;portalLink 走它,member 不是租户表 |
| P0 | `src/db/schema/portal-link.ts` | 全 | 联结表结构 + `uq_portal_link_student_user` 唯一约束(幂等 link 的依据) |
| P0 | `src/app/dashboard/students/page.tsx` | 全 | 学生页现结构(将被迁入 students-tab + 改为重定向) |
| P0 | `src/app/dashboard/students/actions.ts` | 全 | Server Action 五步范式(auth→RBAC→zod→forTenant→revalidate);`listStudents` 复用 |
| P0 | `src/app/dashboard/students/portal-actions.ts` | 全 | 现「开通登录」动作;`ProvisionResult` data-not-thrown 错误约定(React #441) |
| P1 | `src/auth/permissions.ts` | 14-82 | 角色矩阵:owner/admin 持 `member:create`;parent/student 门户角色权限 |
| P1 | `src/auth/authorize.ts` | 全 | `can()` / `requirePermission()`;`isPlatformAdmin` 旁路 |
| P1 | `src/auth/context.ts` | 全 | `requireAuthContext` / `AuthContext`;`member.organizationId === tenantId` |
| P1 | `src/app/dashboard/students/portal-account-form.tsx` | 全 | 客户端 provision 表单模式(useTransition + router.refresh + data 错误展示) |
| P1 | `src/app/dashboard/_nav/nav-links.tsx` | 全 | 顶栏导航 + 「教务工作台」cluster 写法(用户管理入口镜像) |
| P1 | `src/app/dashboard/layout.tsx` | 全 | 布局层 UX 守卫(portal 角色重定向);真实鉴权仍在各 action |
| P2 | `tests/provision-portal.test.ts` | 全 | DB 集成测试范式(seed org/user/member、cleanup、ctxFor、幂等/防跨租户断言) |
| P2 | `tests/e2e/dashboard/students.spec.ts` | 全 | students e2e 模式(唯一命名、section 定位、自包含) |
| P2 | `tests/e2e/dashboard/smoke.spec.ts` | 全 | 导航 name→href 断言(需同步改) |
| P2 | `src/db/queries/organizations.ts` | 全 | `src/db/queries/` 读查询放置约定 |

## External Documentation
无外部研究需要 — 功能完全基于既有内部模式(Better Auth org/admin 插件、Drizzle、Next.js Server Actions)。Better Auth `auth.api.createUser` / `addMember` 的用法已在 `provision.ts` 内验证(1.7.4),照抄即可。

---

## Patterns to Mirror

### SERVER_ACTION_范式(auth → RBAC → zod → forTenant → revalidate → data-error)
```ts
// SOURCE: src/app/dashboard/students/portal-actions.ts:19-32
export async function provisionPortalAccount(input: ProvisionPortalInput): Promise<ProvisionResult> {
  const ctx = await requireAuthContext()            // 1) 已验证 principal + tenant
  requirePermission(ctx, { member: ['create'] })    // 2) 顶部 RBAC 守卫
  try {
    const res = await provisionPortalAccountCore(ctx, input) // 3) 委托无头核心(校验+写)
    revalidatePath('/dashboard/students')
    return { ok: true, ...res }
  } catch (e) {
    console.error('provisionPortalAccount failed', e)
    return { ok: false, error: e instanceof Error ? e.message : '开通登录失败' } // 错误作为 DATA 返回
  }
}
```

### 无头核心 + 幂等 + 防跨租户 + 补偿(link 核心镜像此)
```ts
// SOURCE: src/auth/provision.ts:57-93 (provisionPortalMember) + 102-145 (Core)
// 复用点:provisionPortalMember 负责「建 user+member(不建 link)」,正是「新建用户不绑学生」所需。
// 现有 Core 做的「幂等 link」正是独立 linkPortalUserCore 要抽出的逻辑:
const linked = (await forTenant(ctx).select(
  portalLink,
  and(eq(portalLink.studentId, data.studentId), eq(portalLink.userId, userId)),
)) as unknown[]
if (linked.length === 0) {
  await forTenant(ctx).insert(portalLink, { studentId: data.studentId, userId, relationship: data.kind })
}
```

### 租户作用域读写(portalLink 是租户表 → 必须走 forTenant)
```ts
// SOURCE: src/db/tenant.ts:14-55
forTenant(ctx).select(table, extraSQL)  // WHERE tenantId=ctx.tenantId AND extra
forTenant(ctx).insert(table, values)    // 强制注入 tenantId
forTenant(ctx).findById(table, id)      // 租户内按 id 取单行
forTenant(ctx).delete(table, id)        // 租户内删除
```

### 多角色逗号串解析(过滤门户账号时的坑)
```ts
// SOURCE: src/auth/portal.ts:11-14
export function isPortalRole(role: string): boolean {
  const roles = role.split(',').map((r) => r.trim())
  return roles.some((r) => (PORTAL_ROLES as readonly string[]).includes(r))
}
```

### 读查询放置(member 非租户表,按 organizationId=tenantId 直查)
```ts
// SOURCE: src/db/queries/organizations.ts:8-15  (member.organizationId 即 tenantId)
const [m] = await db.select({ organizationId: member.organizationId })
  .from(member).where(eq(member.userId, userId)).limit(1)
```

### 客户端 provision 表单(useTransition + router.refresh + data 错误)
```tsx
// SOURCE: src/app/dashboard/students/portal-account-form.tsx:27-48
const [pending, startTransition] = useTransition()
function submit() {
  startTransition(async () => {
    const res = await provisionPortalAccount({ ... })
    if (!res.ok) { setError(res.error); return }
    setEmail(res.email); router.refresh()
  })
}
```

### DB 集成测试范式
```ts
// SOURCE: tests/provision-portal.test.ts:30-63
const ctxFor = (tenantId, userId, role='owner'): AuthContext => ({ tenantId, userId, role, isPlatformAdmin:false })
// beforeAll: cleanup → insert org/user/member/student;afterAll: cleanup(按 org/email/id 清 portalLink→student→member→account→user→org)
```

### E2E 范式(唯一命名 + section 定位 + 自包含)
```ts
// SOURCE: tests/e2e/dashboard/students.spec.ts:13-34
const name = `E2E临时-xxx-${Date.now()}`      // 全局唯一,不依赖全局计数
function activeRow(page, name){ return activeList(page).locator('li').filter({ hasText: name }) }
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/app/dashboard/users/page.tsx` | CREATE | 用户管理页:解析 `?tab`,渲染 Tab 栏 + 对应 Tab;页级 gate `student:list` |
| `src/app/dashboard/users/students-tab.tsx` | CREATE | 学生 Tab(从 students/page.tsx 抽出的 section,复用 students/ 下 actions/forms) |
| `src/app/dashboard/users/parents-tab.tsx` | CREATE | 家长 Tab:列门户账号 + 关联学生 + 新建用户 + link/unlink;自身 requirePermission member:create |
| `src/app/dashboard/users/data.ts` | CREATE | `listPortalUsers(ctx)` 读查询(member∩user + portalLink∩student 名) |
| `src/app/dashboard/users/user-actions.ts` | CREATE | Server Actions:`createPortalUser` / `linkPortalUser` / `unlinkPortalUser` |
| `src/app/dashboard/users/user-form.tsx` | CREATE | 客户端「新建门户用户」表单(家长/学生,可不绑学生) |
| `src/app/dashboard/users/link-control.tsx` | CREATE | 客户端关联/解绑控件(学生选择器 ↔ 账号选择器,双向复用) |
| `src/auth/provision.ts` | UPDATE | 新增无头核心 `createPortalUserCore` / `linkPortalUserCore` / `unlinkPortalUserCore`(复用 `provisionPortalMember`) |
| `src/app/dashboard/students/page.tsx` | UPDATE | 改为 `redirect('/dashboard/users?tab=students')` |
| `src/app/dashboard/_nav/nav-links.tsx` | UPDATE | 「学生」链接替换为「用户管理」→ `/dashboard/users` |
| `tests/e2e/dashboard/smoke.spec.ts` | UPDATE | 导航断言 `学生/students` → `用户管理/users` |
| `tests/e2e/dashboard/students.spec.ts` | UPDATE | `goto` 指向 `/dashboard/users?tab=students`(或依赖重定向);其余断言不变 |
| `tests/portal-admin.test.ts` | CREATE | create/link/unlink 核心的 DB 集成测试 |
| `tests/e2e/dashboard/users.spec.ts` | CREATE | 用户页 e2e:Tab 切换、新建家长、关联/解绑学生 |

## NOT Building
- ❌ **不**新建 `parent` 领域表 / `student_parent` 联结表 / 数据迁移(已决策:家长=门户账号)。
- ❌ **不**迁移 student 表上的反规范化家长字段(parentName/Phone/Wechat/Email)——它们作为「联系信息」保留原样,与门户账号并存。
- ❌ **不**改动 `provisionPortalAccountCore` 现有签名/行为(学生页「开通登录」保持不变),仅新增并列核心。
- ❌ **不**给 teacher/assistant 开放家长管理(家长 Tab 仅 owner/admin);学生 Tab 维持对全体 staff 可见。
- ❌ **不**做密码重置、账号禁用/删除、批量导入(超出本次范围)。
- ❌ **不**改 `portalLink` / `member` / 任何 schema。
- ❌ **不**触碰 `/portal`(家长/学生登录侧)页面。

---

## Step-by-Step Tasks

### Task 1: 新增无头核心 —— createPortalUserCore(建账号,不绑学生)
- **ACTION**: 在 `src/auth/provision.ts` 末尾新增 `createPortalUserCore`。
- **IMPLEMENT**:
  ```ts
  export const createPortalUserSchema = z.object({
    name: z.string().trim().min(1, '姓名不能为空').max(100),
    kind: z.enum(['parent', 'student']),
    loginId: z.string().trim().max(100).optional(),
    password: z.string().min(8, '密码至少 8 位'),
  })
  export type CreatePortalUserInput = z.input<typeof createPortalUserSchema>

  export async function createPortalUserCore(
    ctx: AuthContext,
    input: CreatePortalUserInput,
  ): Promise<{ userId: string; email: string }> {
    const data = createPortalUserSchema.parse(input)
    const email = data.loginId && data.loginId.includes('@')
      ? data.loginId.toLowerCase()
      : `portal_${nanoid()}@${env.PORTAL_EMAIL_DOMAIN}`
    const { userId } = await provisionPortalMember({
      name: data.name, email, password: data.password,
      orgId: ctx.tenantId, orgRole: data.kind,
    })
    return { userId, email }
  }
  ```
- **MIRROR**: `provisionPortalAccountCore`(去掉 studentId 与 link 步骤);email 合成同 provision.ts:112-115。
- **IMPORTS**: 已在文件内(`z`、`nanoid`、`env`、`provisionPortalMember`、`AuthContext`)。
- **GOTCHA**: `provisionPortalMember` 对「邮箱已属他机构」抛 `该邮箱已被其他账号占用`——透传即可(data-error 在 action 层兜)。无 link 步骤 → 无需补偿(member 存在即合法状态)。
- **VALIDATE**: `tests/portal-admin.test.ts` 断言建后 member 恰 1 条、role 正确、portalLink 为 0。

### Task 2: 新增无头核心 —— linkPortalUserCore / unlinkPortalUserCore(独立关联/解绑)
- **ACTION**: 在 `src/auth/provision.ts` 新增两个核心。
- **IMPLEMENT**:
  ```ts
  export const linkPortalUserSchema = z.object({
    userId: z.string().trim().min(1),
    studentId: z.string().trim().min(1),
    relationship: z.enum(['parent', 'student']).optional(), // 缺省从 member.role 推断
  })
  export type LinkPortalUserInput = z.input<typeof linkPortalUserSchema>

  export async function linkPortalUserCore(ctx: AuthContext, input: LinkPortalUserInput): Promise<void> {
    const data = linkPortalUserSchema.parse(input)
    // 1) 目标 user 必须是【本机构】成员(防跨租户注入 — 镜像 provisionPortalMember 的拒绝逻辑)
    const [m] = await db.select({ role: member.role }).from(member)
      .where(and(eq(member.userId, data.userId), eq(member.organizationId, ctx.tenantId))).limit(1)
    if (!m) throw new Error('该用户不属于本机构')
    // 2) 学生必须在本租户
    const s = await forTenant(ctx).findById(student, data.studentId)
    if (!s) throw new Error('学生不存在')
    // 3) relationship:入参 > member.role 推断('parent'|'student')
    const relationship = data.relationship ?? (isPortalRole(m.role) && m.role.includes('student') ? 'student' : 'parent')
    // 4) 幂等 insert(唯一约束 uq_portal_link_student_user 兜底)
    const existing = (await forTenant(ctx).select(portalLink,
      and(eq(portalLink.studentId, data.studentId), eq(portalLink.userId, data.userId)))) as unknown[]
    if (existing.length === 0) {
      await forTenant(ctx).insert(portalLink, { studentId: data.studentId, userId: data.userId, relationship })
    }
  }

  export async function unlinkPortalUserCore(ctx: AuthContext, userId: string, studentId: string): Promise<void> {
    // portalLink 是租户表 → 走 forTenant;删除 (tenant, student, user) 的联结行
    await db.delete(portalLink).where(and(
      eq(portalLink.tenantId, ctx.tenantId),
      eq(portalLink.studentId, studentId),
      eq(portalLink.userId, userId),
    ))
  }
  ```
- **MIRROR**: 幂等 link 段落照 `provisionPortalAccountCore`;成员校验照 `provisionPortalMember` 的「非本机构 → 拒绝」;`isPortalRole` 来自 portal.ts。
- **IMPORTS**: `import { student, portalLink, member } from '@/db/schema'`(provision.ts 已引 userTable/member/account/student/portalLink,补 `member` 若缺);`import { isPortalRole } from '@/auth/portal'`。
- **GOTCHA**:
  - **安全关键**:不校验「member 属本机构」就 insert portalLink,会让任意 userId 被塞进本租户学生——正是 provision.ts:76 防的跨租户注入。必须先查 member。
  - `forTenant().delete(table, id)` 仅按主键 id 删;这里要按 (student,user) 复合条件删,故直接 `db.delete().where(...)` **并显式带 `tenantId` 条件**(不要漏,否则跨租户误删)。
  - relationship 推断:member.role 可能是逗号多角色;用 `isPortalRole`/`includes` 稳妥,缺省给 'parent'。
- **VALIDATE**: 测试:link 幂等(重复 link 不产生第二行)、link 外机构 user 抛 `该用户不属于本机构`、unlink 后行数为 0、unlink 只影响本租户。

### Task 3: 读查询 —— listPortalUsers(账号 + 其关联学生名)
- **ACTION**: 新建 `src/app/dashboard/users/data.ts`。
- **IMPLEMENT**:
  ```ts
  import 'server-only'
  import { and, eq, inArray } from 'drizzle-orm'
  import { db } from '@/db'
  import { member, user, portalLink, student } from '@/db/schema'
  import { forTenant } from '@/db/tenant'
  import { isPortalRole } from '@/auth/portal'
  import type { AuthContext } from '@/auth/context'

  export type PortalUserRow = {
    userId: string; name: string; email: string; role: string
    students: { id: string; name: string }[]
  }

  export async function listPortalUsers(ctx: AuthContext): Promise<PortalUserRow[]> {
    // 1) 本机构成员 ∩ user;member 非租户表 → 按 organizationId=tenantId 直查(见 organizations.ts)
    const rows = await db.select({ userId: user.id, name: user.name, email: user.email, role: member.role })
      .from(member).innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, ctx.tenantId))
    const portalUsers = rows.filter((r) => isPortalRole(r.role)) // 逗号多角色 → JS 过滤
    if (portalUsers.length === 0) return []
    // 2) 关联学生名:portalLink(租户表→forTenant) + student 名
    const links = (await forTenant(ctx).select(portalLink)) as (typeof portalLink.$inferSelect)[]
    const students = (await forTenant(ctx).select(student)) as (typeof student.$inferSelect)[]
    const nameById = new Map(students.map((s) => [s.id, s.name]))
    const linksByUser = new Map<string, { id: string; name: string }[]>()
    for (const l of links) {
      if (!nameById.has(l.studentId)) continue
      const arr = linksByUser.get(l.userId) ?? []
      arr.push({ id: l.studentId, name: nameById.get(l.studentId)! })
      linksByUser.set(l.userId, arr)
    }
    return portalUsers.map((u) => ({ ...u, students: linksByUser.get(u.userId) ?? [] }))
  }
  ```
- **MIRROR**: member 直查照 `src/db/queries/organizations.ts`;`isPortalRole` 照 portal.ts;portalLink 走 forTenant 照 portal.ts:19-25。
- **IMPORTS**: 见上。
- **GOTCHA**: member.role 逗号多角色 → **不要**用 `inArray(member.role, ['parent','student'])`(不匹配 `'parent,student'`),必须 JS 侧 `isPortalRole` 过滤。
- **VALIDATE**: 家长 Tab 渲染出账号与其学生名;e2e 断言新建家长后出现在列表。

### Task 4: Server Actions —— createPortalUser / linkPortalUser / unlinkPortalUser
- **ACTION**: 新建 `src/app/dashboard/users/user-actions.ts`(`'use server'`)。
- **IMPLEMENT**:
  ```ts
  'use server'
  import { revalidatePath } from 'next/cache'
  import { requireAuthContext } from '@/auth/context'
  import { requirePermission } from '@/auth/authorize'
  import {
    createPortalUserCore, linkPortalUserCore, unlinkPortalUserCore,
    type CreatePortalUserInput, type LinkPortalUserInput,
  } from '@/auth/provision'

  export type CreateUserResult = { ok: true; userId: string; email: string } | { ok: false; error: string }
  export type MutResult = { ok: true } | { ok: false; error: string }

  export async function createPortalUser(input: CreatePortalUserInput): Promise<CreateUserResult> {
    const ctx = await requireAuthContext()
    requirePermission(ctx, { member: ['create'] })
    try {
      const res = await createPortalUserCore(ctx, input)
      revalidatePath('/dashboard/users')
      return { ok: true, ...res }
    } catch (e) {
      console.error('createPortalUser failed', e)
      return { ok: false, error: e instanceof Error ? e.message : '新建用户失败' }
    }
  }

  export async function linkPortalUser(input: LinkPortalUserInput): Promise<MutResult> {
    const ctx = await requireAuthContext()
    requirePermission(ctx, { member: ['create'] })
    try {
      await linkPortalUserCore(ctx, input)
      revalidatePath('/dashboard/users')
      return { ok: true }
    } catch (e) {
      console.error('linkPortalUser failed', e)
      return { ok: false, error: e instanceof Error ? e.message : '关联失败' }
    }
  }

  export async function unlinkPortalUser(userId: string, studentId: string): Promise<MutResult> {
    const ctx = await requireAuthContext()
    requirePermission(ctx, { member: ['delete'] })
    try {
      await unlinkPortalUserCore(ctx, userId, studentId)
      revalidatePath('/dashboard/users')
      return { ok: true }
    } catch (e) {
      console.error('unlinkPortalUser failed', e)
      return { ok: false, error: e instanceof Error ? e.message : '解绑失败' }
    }
  }
  ```
- **MIRROR**: 五步范式 + data-error 约定,完全照 `students/portal-actions.ts:19-32`。
- **IMPORTS**: 见上。
- **GOTCHA**: 错误必须作为 **data 返回**(不 throw),否则生产环境 React #441 会把中文业务错误抹成通用串(provision.ts 注释已说明)。create/link gate `member:['create']`,unlink gate `member:['delete']`——owner/admin 皆持有,teacher/assistant 无(符合「家长管理仅管理者」)。
- **VALIDATE**: `pnpm typecheck`;e2e 走通新建/关联/解绑。

### Task 5: 客户端表单/控件 —— user-form.tsx + link-control.tsx
- **ACTION**: 新建两个 `'use client'` 组件。
- **IMPLEMENT**:
  - `user-form.tsx`:镜像 `portal-account-form.tsx`,但去掉 studentId,调用 `createPortalUser`;字段:账号类型(家长/学生 select)、显示名、登录邮箱(选填)、密码;成功展示合成邮箱。
  - `link-control.tsx`:一个 `<select>` 学生(或账号)下拉 + [关联] 按钮,调用 `linkPortalUser`;已关联项旁 [解绑] 调 `unlinkPortalUser`。用 `useTransition` + `router.refresh()`;错误以 data 展示。props 设计成**双向复用**:
    ```tsx
    // 家长 Tab:mode='assign-student',fixedUserId=账号,options=可选学生列表
    // 学生 Tab:mode='assign-user',fixedStudentId=学生,options=可选家长/学生账号列表
    ```
- **MIRROR**: `portal-account-form.tsx:10-123`(useTransition/setError/setEmail/router.refresh/展开折叠)。
- **IMPORTS**: `useState`/`useTransition`(react)、`useRouter`(next/navigation)、上面的 actions。
- **GOTCHA**: 下拉 options 应排除**已关联**项以免重复(link 幂等兜底,但 UI 不该给重复选项)。button 需 `type="button"` 防表单误提交(照现有表单)。
- **VALIDATE**: e2e 点选下拉 + 关联 + 断言行内出现学生名;点解绑后消失。

### Task 6: 学生 Tab —— 从 students/page.tsx 抽出 + 加关联账号展示
- **ACTION**: 新建 `src/app/dashboard/users/students-tab.tsx`,把 `students/page.tsx` 的 `<section>` 主体迁入(改为可复用组件),并在每个在读学生行追加「关联账号 + [关联家长/学生]」。
- **IMPLEMENT**: 复用 `students/actions.ts` 的 `listStudents`、`students/share-data.ts` 的 `getActiveShare`、现有 `StudentForm`/`ExportPanel`/`PortalAccountForm`/`StudentRestore`。新增:调 `listPortalUsers(ctx)` 求出「学生→已关联账号」映射,渲染并挂 `link-control`(mode='assign-user',fixedStudentId=s.id)。
- **MIRROR**: `students/page.tsx:11-75`(整体结构原样搬);数据并行 `Promise.all` 照 21-19 行。
- **IMPORTS**: 从 `../../students/*` 引现有组件/actions(相对路径),或将其路径别名化。保留 `<h2>学生</h2>`(students.spec 的 heading 断言依赖)。
- **GOTCHA**: 组件是 **server component**(需 ctx 与 DB)。`link-control` 的账号 options = `listPortalUsers` 结果里**尚未**关联此学生者。
- **VALIDATE**: `/dashboard/users?tab=students` 与旧页视觉一致;students.spec 断言(创建/编辑/归档/分享/开通)全绿。

### Task 7: 家长 Tab —— parents-tab.tsx
- **ACTION**: 新建 `src/app/dashboard/users/parents-tab.tsx`(server component)。
- **IMPLEMENT**:
  ```tsx
  export default async function ParentsTab() {
    const ctx = await requireAuthContext()
    requirePermission(ctx, { member: ['create'] }) // 家长 Tab 仅管理者
    const [users, students] = await Promise.all([listPortalUsers(ctx), listStudents()])
    // 渲染:UserForm(新建);每个账号一行 → 名/role/email + 已关联学生(各带解绑) + LinkControl(assign-student, options=未关联学生)
  }
  ```
- **MIRROR**: `students/page.tsx` 的列表/section 结构;权限守卫照 provision action。
- **IMPORTS**: `requireAuthContext`/`requirePermission`、`listPortalUsers`(./data)、`listStudents`(../../students/actions)、`UserForm`/`LinkControl`。
- **GOTCHA**: 本组件**自身**再做一次 `requirePermission(member:create)`——即便页级已判 canManage,直接命中 `?tab=parents` 也不能漏(纵深防御);抛 AuthError 会走 `dashboard/error.tsx`,但更好体验是页级在 `!canManage` 时把 tab 收敛回 students(见 Task 8)。
- **VALIDATE**: owner 可见并操作;e2e。

### Task 8: 用户管理页 —— page.tsx(Tab 路由 + 权限收敛)
- **ACTION**: 新建 `src/app/dashboard/users/page.tsx`。
- **IMPLEMENT**:
  ```tsx
  export default async function UsersPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
    const ctx = await requireAuthContext()
    requirePermission(ctx, { student: ['list'] })        // 页级:全体 staff 可看学生 Tab
    const canManageUsers = can(ctx.role, { member: ['create'] })
    const { tab: rawTab } = await searchParams
    const tab = rawTab === 'parents' && canManageUsers ? 'parents' : 'students' // 无权 → 收敛回 students
    return (
      <section className="flex flex-col gap-6">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold">用户管理</h2>
          <nav className="flex gap-2 text-sm">
            <TabLink href="/dashboard/users?tab=students" active={tab==='students'}>学生</TabLink>
            {canManageUsers && <TabLink href="/dashboard/users?tab=parents" active={tab==='parents'}>家长</TabLink>}
          </nav>
        </div>
        {tab === 'students' ? <StudentsTab /> : <ParentsTab />}
      </section>
    )
  }
  ```
- **MIRROR**: `can`/`requirePermission` 用法照 `lessons-panel.tsx:22` 与 students/page.tsx:12-13。
- **IMPORTS**: `requireAuthContext`/`requirePermission`(@/auth/context,@/auth/authorize 的 `can`)、`StudentsTab`、`ParentsTab`。
- **GOTCHA**: **Next 16 里 `searchParams` 是 Promise**,必须 `await`(参见项目 async `headers()` 约定)。Tab 用 `<Link>`(server 渲染,active 由 `tab` 值判断,无需 usePathname)。
- **VALIDATE**: 切 Tab URL 变化、内容切换;teacher 账号看不到「家长」Tab 且 `?tab=parents` 被收敛回 students。

### Task 9: 旧学生路由重定向
- **ACTION**: 改 `src/app/dashboard/students/page.tsx` 为重定向。
- **IMPLEMENT**:
  ```tsx
  import { redirect } from 'next/navigation'
  export default function StudentsPage() { redirect('/dashboard/users?tab=students') }
  ```
- **GOTCHA**: 保留 `students/` 目录下其余文件(actions/forms/其它)——它们被 students-tab 复用。仅 page.tsx 变重定向。`redirect()` 抛特殊错误正常(勿 try/catch 包裹)。
- **VALIDATE**: 访问 `/dashboard/students` 落到用户页学生 Tab。

### Task 10: 顶栏导航替换
- **ACTION**: 改 `src/app/dashboard/_nav/nav-links.tsx`,把 `<NavLink href="/dashboard/students">学生</NavLink>` 换成 `<NavLink href="/dashboard/users" activePrefix="/dashboard/users">用户管理</NavLink>`。
- **MIRROR**: 现有 NavLink 用法(activePrefix 让子路由高亮)。
- **GOTCHA**: 移除 `学生` 链接会破坏 smoke.spec 断言 → **必须**同步改 smoke.spec(Task 11)。文件顶注释提到「保留 legacy 链接给 smoke」——本次是有意重构,更新注释一并说明。
- **VALIDATE**: 顶栏出现「用户管理」,点击进入 `/dashboard/users`。

### Task 11: 同步 e2e 断言(smoke + students)
- **ACTION**: 改两个 e2e。
- **IMPLEMENT**:
  - `smoke.spec.ts`:nav 数组把 `{ name:'学生', href:'/dashboard/students' }` 换成 `{ name:'用户管理', href:'/dashboard/users' }`。
  - `students.spec.ts`:各 `page.goto('/dashboard/students')` 改为 `page.goto('/dashboard/users?tab=students')`(或保留,依赖 302);heading `学生` exact 断言仍成立(students-tab 内保留 `<h2>学生</h2>`)。若 Tab 栏的「学生」是 `role=link` 而 heading 是 `role=heading`,二者不冲突。
- **GOTCHA**: students.spec 若走重定向,`page.goto('/dashboard/students')` 后 URL 会变 `/dashboard/users?tab=students`——其内部断言不判 URL,故安全;为清晰仍建议直接 goto 新地址。
- **VALIDATE**: `pnpm test:e2e -g "学生管理|Dashboard 入口冒烟"` 全绿。

### Task 12: 单测 —— tests/portal-admin.test.ts
- **ACTION**: 新建核心的 DB 集成测试。
- **IMPLEMENT**: 照 `provision-portal.test.ts` 的 seed/cleanup/ctxFor 骨架,覆盖:
  - `createPortalUserCore`:建后 member 恰 1、role 对、portalLink 0;邮箱合成(无 loginId → `portal_*@portal.local`)。
  - `linkPortalUserCore`:link 幂等(重复不加行);外机构 user → 抛 `该用户不属于本机构`;学生不存在 → 抛 `学生不存在`;一账号 link 多学生。
  - `unlinkPortalUserCore`:link 后 unlink → 行数 0;只删本租户(另建 orgOther 同 (student,user) 不受影响)。
- **MIRROR**: `tests/provision-portal.test.ts` 全套。
- **GOTCHA**: cleanup 必须清 portalLink→student→member→account→user→org(FK 顺序);合成邮箱按 `like 'portal_%@portal.local'` 清。
- **VALIDATE**: `pnpm test portal-admin`。

### Task 13: E2E —— tests/e2e/dashboard/users.spec.ts
- **ACTION**: 新建用户页 e2e。
- **IMPLEMENT**: owner storageState;用例:
  1. 进 `/dashboard/users`,断言 heading `用户管理` + 两个 Tab 可见。
  2. 切「家长」Tab,新建家长账号(唯一名/密码≥8),断言出现在门户账号列表并显示合成/输入邮箱。
  3. 先在学生 Tab 建一个唯一学生;回家长 Tab 用 link-control 关联该学生,断言账号行出现学生名;点解绑后消失。
- **MIRROR**: `students.spec.ts`(唯一命名 + section 定位 + 自包含)。
- **GOTCHA**: 共享 DB、workers:1 → 全部唯一命名,勿断言全局计数。
- **VALIDATE**: `pnpm test:e2e -g 用户`。

---

## Testing Strategy

### Unit Tests(tests/portal-admin.test.ts,DB 集成)
| Test | Input | Expected | Edge? |
|---|---|---|---|
| create 建号不绑 | {name,kind:'parent',pwd} | member=1,role='parent',portalLink=0 | — |
| create 合成邮箱 | 无 loginId | email 匹配 `/^portal_.+@portal\.local$/` | 微信无邮箱 |
| link 幂等 | 同 (user,student) link ×2 | portalLink 恒 1 行 | 重复 |
| link 防跨租户 | 外机构 userId | throw `该用户不属于本机构` | 安全 |
| link 学生不存在 | 假 studentId | throw `学生不存在` | 校验 |
| link 一号多生 | 同 user,两 student | 2 行 | 多对多 |
| unlink | link 后 unlink | 0 行 | — |
| unlink 租户隔离 | orgOther 同键不受影响 | 只删本租户 | 安全 |

### Edge Cases Checklist
- [ ] 空/超长姓名(zod min/max)
- [ ] 密码 < 8(throw `密码至少 8 位`)
- [ ] 邮箱已属他机构(throw `该邮箱已被其他账号占用`)
- [ ] 重复关联(幂等)
- [ ] 逗号多角色 member('parent,student')能被 `isPortalRole` 识别、被 listPortalUsers 收录
- [ ] teacher/assistant 访问 `?tab=parents` → 收敛回 students(无异常页)
- [ ] 跨租户:link/unlink/list 均不泄漏/误删他租户

---

## Validation Commands

### 静态分析
```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
```
EXPECT: 0 type / lint 错误。

### 单元/集成测试
```bash
pnpm test portal-admin           # 新增核心
pnpm test provision-portal       # 确认未回归
```
EXPECT: 全通过。

### 全量单测
```bash
pnpm test
```
EXPECT: 无回归。

### E2E
```bash
pnpm test:e2e -g "用户|学生管理|Dashboard 入口冒烟"
```
EXPECT: users / students / smoke 全绿。

### 手动验证
- [ ] owner 登录 → 顶栏「用户管理」→ `/dashboard/users`,默认学生 Tab。
- [ ] 学生 Tab:建/编辑/归档/分享/开通登录 均正常;学生行显示已关联账号 + 可关联家长。
- [ ] 家长 Tab:新建家长(展示邮箱)→ 关联多个学生 → 各自解绑。
- [ ] 访问旧 `/dashboard/students` → 302 到用户页学生 Tab。
- [ ] 以 teacher 账号:能看学生 Tab,看不到家长 Tab,直接 `?tab=parents` 被收敛。

---

## Acceptance Criteria
- [ ] `/dashboard/users` 存在,学生/家长两 Tab 可切换。
- [ ] 学生列表功能等价迁入;旧路由 302。
- [ ] 家长 Tab 列出门户账号及其关联学生。
- [ ] 可新建家长/学生门户账号(可不绑学生)。
- [ ] 可把已有家长 assign 到学生、把学生 assign 到家长(双向 link/unlink,幂等)。
- [ ] 权限:家长管理仅 owner/admin;学生 Tab 全体 staff 可见。
- [ ] typecheck / lint / test / e2e 全绿。

## Completion Checklist
- [ ] 代码遵循五步 Server Action 范式与 data-error 约定。
- [ ] 租户表读写一律走 `forTenant`;member 直查带 organizationId=tenantId;delete 显式带 tenantId。
- [ ] link 前校验 member 属本机构(防跨租户注入)。
- [ ] 错误经 console.error 记录并作为 data 返回。
- [ ] 测试遵循现有 DB 集成 / e2e 范式。
- [ ] 无硬编码 zone/域名(邮箱域用 `env.PORTAL_EMAIL_DOMAIN`)。
- [ ] AGENTS.md 顶部自动块若被 `next dev` 改动,随本次一并提交(勿单独回退)。

## Risks
| Risk | 概率 | 影响 | 缓解 |
|---|---|---|---|
| link 漏校验 member 归属 → 跨租户注入 | 中 | 高 | Task 2 强制先查 member(orgId=tenantId);单测「防跨租户」用例 |
| unlink 用 db.delete 漏 tenantId → 误删他租户 | 中 | 高 | 显式三条件 where(含 tenantId);单测租户隔离用例 |
| 移除「学生」nav 破坏 smoke.spec | 高 | 低 | Task 11 同步更新断言 |
| member.role 逗号多角色被 inArray 漏掉 | 中 | 中 | 一律 `isPortalRole` JS 过滤,禁用 inArray(role) |
| Next 16 searchParams 未 await | 中 | 中 | Task 8 GOTCHA 明确 `await searchParams` |
| students.spec heading 与 Tab「学生」链接选择器冲突 | 低 | 低 | heading 用 `role=heading` 精确、Tab 用 `role=link`;保留 `<h2>学生</h2>` |

## Notes
- 决策(用户已确认):① 家长 = 门户账号(复用现有,无新表/无迁移);② 单页 `/dashboard/users` + 学生/家长 Tab,旧 `/dashboard/students` 302。
- 复用面:`provisionPortalMember`(建号)、`portalLink`/`forTenant`(关联)、五步 Server Action 范式、`isPortalRole`、DB 集成与 e2e 测试骨架——新增逻辑量小,风险集中在**租户/跨机构边界**,已由单测覆盖。
- 未来可选(本次不做):账号禁用/删除、密码重置、把 student 反规范化家长字段抽成正式 parent 档案。
