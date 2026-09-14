# Plan: Phase 5 — Progress Reports（学生进度报告）

## Summary
为每个学生生成 PDF 进度报告：叙述性文字由 Claude 起草、教师审核后定稿（draft → approved 门禁），出勤/成绩等**数字一律从数据库直接渲染**（Claude 不得编造事实）。PDF 用 `@react-pdf/renderer` 免 Chromium 生成并内嵌 Noto Sans SC 中文字体；小班支持顺序批量循环 + ZIP 打包下载。

## User Story
作为一名独立教师，我想为某个学生（或某小班批量）一键生成一份数字准确、中文不豆腐、由 AI 起草而我可改可批准的 PDF 进度报告，这样我就能把月末写报告的时间降到手写基线的 ≤30%，同时不担心 AI 把出勤/成绩写错。

## Problem → Solution
**现状**：报告靠手写，耗时且随学生数线性增长；无结构化的进度沉淀。
**目标态**：系统聚合 DB 中的出勤/成绩/笔记 → Claude 起草中文叙述 → 教师在 UI 内审核/编辑/批准 → 导出 PDF（单份或小班 ZIP）。数字从 DB 渲染保证准确，叙述经教师定稿保证可信。

## Metadata
- **Complexity**: Large（新增 1 张表 + 1 个 enum + 1 组 RBAC statement + Claude 集成 + react-pdf 渲染 + 服务端 actions + 2 条导出路由 + 报告仪表盘 UI + 测试）
- **Source PRD**: `.claude/PRPs/prds/course-scheduling-system.prd.md`
- **PRD Phase**: Phase 5 — Progress Reports（依赖 Phase 2 已完成、Phase 4 模板/数据沉淀；可与 Phase 6 并行）
- **Estimated Files**: ~18（新建 ~13，修改 ~5）

---

## UX Design

### Before
```
┌─────────────────────────────────────────────┐
│  教师手写报告（Word/微信），逐个学生复述        │
│  出勤/成绩靠回忆或翻记录，易错、耗时            │
└─────────────────────────────────────────────┘
```

### After
```
┌───────────────────────────────────────────────────────────┐
│  /dashboard/reports                                         │
│  选择学生 + 时间窗 → [生成草稿]                              │
│    → Claude 起草叙述（数字来自 DB，教师不可改数字）          │
│  草稿卡片：可编辑叙述文本域 · 状态徽标 draft                 │
│    → [保存] / [批准] （批准后锁定为 approved）               │
│  [下载 PDF]（单份，inline）                                 │
│  班级页：[批量导出本班报告 ZIP]（每个学生一份 approved PDF） │
└───────────────────────────────────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| 生成报告 | 手写 | 一键 Claude 起草 | 数字 DB 直渲，叙述可改 |
| 数据准确性 | 靠人核对 | DB 渲染，不经 LLM | prompt 明确“不得编造事实” |
| 定稿 | 无门禁 | draft → approved 门禁 | 仅 approved 计入批量 ZIP |
| 中文渲染 | N/A | 内嵌 Noto Sans SC .ttf | 缺字形会静默豆腐，须早验证 |
| 合规告知 | N/A | 已在 `privacy/page.tsx:47` 预告 | Claude 起草报告文本已对家长声明（PIPL） |

---

## Mandatory Reading

实现前**必须**读的文件（皆为本仓库真实文件，行号截至撰写时）：

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/db/schema/grade.ts` | 1-58 | 成绩表结构 + `numeric` 返回 **string** 的坑 + `onDelete('restrict')` 学术记录保护；新表 mirror 此模式 |
| P0 | `src/db/schema/attendance.ts` | 1-39 | 出勤表：`(tenant,lesson,student)` 唯一、状态枚举、审计不 cascade |
| P0 | `src/db/schema/_helpers.ts` | 1-20 | `primaryId/tenantId/createdAt/updatedAt` 复用助手 |
| P0 | `src/db/tenant.ts` | 1-55 | `forTenant(ctx)` 是访问租户数据的**唯一**入口（M1，无 RLS 兜底） |
| P0 | `src/auth/authorize.ts` | 1-18 | `requirePermission(ctx, {...})` / `can()`；platformAdmin 绕过 |
| P0 | `src/auth/permissions.ts` | 14-70 | RBAC statement + 六角色矩阵；新增 `report` statement mirror 此 |
| P0 | `src/mcp/message.ts` | 1-32 | **PURE composer** 范式（无 DB/server-only、可直测）→ mirror 给 rubric prompt composer |
| P1 | `src/mcp/register-tools.ts` | 26-91,151-209 | Claude 集成 + `resolveMcpAuthContext→requirePermission→forTenant` 骨架 + `runTool` 错误映射 |
| P1 | `src/app/api/export/section/[sectionId]/route.ts` | 1-105 | **最接近的既有实现**：archiver ZIP、`safe()`+去重、buffer→`new Uint8Array`Response headers；批量报告 ZIP 直接 mirror |
| P1 | `src/app/api/export/student/[studentId]/png/route.ts` | 1-49 | 单产物导出路由：鉴权 + `forTenant.findById` + buffer→Response（PDF 路由 mirror） |
| P1 | `src/app/dashboard/students/actions.ts` | 1-73 | server action 精确形状：`'use server'`→requireAuthContext→requirePermission→zod parse→forTenant→revalidatePath |
| P1 | `src/app/dashboard/students/share-data.ts` | 36-58 | `getStudentLessonsForTenant`：跨表聚合在 forTenant 骨架上（报告数据聚合 mirror） |
| P1 | `src/lib/schedule-card-render.tsx` | 1-20 | 现有 CJK 处理：Debian 镜像装 fonts-noto-cjk 仅供 **Playwright**；react-pdf 需**另行内嵌 .ttf**（见 GOTCHA） |
| P1 | `src/env.ts` | 1-26 | 如何加**可选** env（MCP 全 optional 使 app 无配置也能启动）→ Anthropic key 同样 optional |
| P2 | `tests/mcp-tools.test.ts` | 1-54,166-283 | 测试范式：纯测试（`vi.mock` env-coupled resolver）+ DB 集成（fixture 生命周期、children-before-parents 清理） |
| P2 | `tests/schedule-card.test.ts` | 8-16,68 | **PDF 字体测试的直接 mirror**：本地 fixture 工厂 + `expect(html).toContain('Noto Sans SC')`（防豆腐断言） |
| P2 | `tests/tenant-isolation.test.ts` | 9,26-53 | `ctxFor` 手造 AuthContext 工厂 + 幂等 `cleanup()`（beforeAll+afterAll 皆调，套件可重跑） |
| P2 | `tests/rbac-scheduling.test.ts` | all | `can()` 角色矩阵断言范式 |
| P2 | `vitest.config.ts` | all | `server-only`→stub 别名、`dotenv/config` setup、`@/*` 别名（新测试自动适用，无需改配置） |
| P2 | `src/db/schema/reserved.ts` | 1-40 | 预留表（rescheduleRequest）的 enum + FK + index 写法参考 |
| P2 | `src/app/privacy/page.tsx` | 47 | 报告功能 + Claude 起草已对家长预告（合规告知已就位，无需新增文案） |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Anthropic SDK (TS) | `claude-api` skill（本会话已加载） | `import Anthropic from '@anthropic-ai/sdk'`；`client.messages.create({model, max_tokens, system, messages})`；`response.content` 是 `ContentBlock[]`，须 `if (block.type==='text')` 收窄 |
| 模型 ID | `claude-api` skill → models.md | **默认 `claude-opus-4-8`**（skill 强制默认，除非用户显式换）；`claude-haiku-4-5`/`claude-sonnet-5` 为可选降本档。本计划把模型放 env（默认 opus-4.8），教师可自行切换 |
| Prompt caching | `claude-api` skill → prompt-caching.md | 前缀匹配缓存：**稳定的 rubric 放 `system` 且带 `cache_control:{type:'ephemeral'}`；易变的学生数据放 user turn**（最后断点之后）。opus-4.8 最低 4096 token 才缓存——rubric 达不到则不缓存，无害 |
| 参数坑 | `claude-api` skill | opus-4.8 上 `temperature/top_p/top_k` 与 `budget_tokens` 一律 400——**不要传**。非流式 `max_tokens` 默认 ~16000；叙述短，设 `max_tokens: 2048` 足够 |
| @react-pdf/renderer | 官方（已知稳定路径） | `renderToBuffer(<Document/>)` 服务端免 Chromium 出 PDF；`Font.register({family, src})` 用**本地 .ttf 路径**（不用 Google Fonts URL——会静默豆腐）；**无浏览器**，故无需 Playwright 的 `withLock` 互斥 |

> 说明：报告的 Claude 起草是**单次、无工具**的调用（非 agent、非 MCP、非 draft-and-confirm 令牌）。它借用 MCP 那套“鉴权→按 rubric 生成→教师门禁”的**思路**，但技术上是一个 server-only 的 `@anthropic-ai/sdk` 直调。

---

## Patterns to Mirror

严格照抄以下代码风格；新代码须与既有代码不可区分。

### NAMING_CONVENTION
```ts
// SOURCE: src/db/schema/_helpers.ts:5-20 + src/db/schema/grade.ts:17-34
// 表用 pgTable('snake_case_name', { camelCaseCol: text('snake_case') }, (t)=>[...])
// PK/tenant/时间戳一律用助手：
id: primaryId(), tenantId: tenantId(), createdAt: createdAt(), updatedAt: updatedAt(),
// 组合 FK 指向 (tenant_id, id)，学术记录用 .onDelete('restrict')
```

### ERROR_HANDLING
```ts
// SOURCE: src/lib/errors.ts:3-8 + src/auth/context.ts:8-13
// 领域错误用具名 class：AuthError(code) / ConflictError(detail)；业务规则用 throw new Error('中文')
// server action 直接 throw；Next 会向调用方冒泡。校验用 zod（.parse 抛 ZodError）
export class AuthError extends Error { constructor(public code: '...'){ super(code); this.name='AuthError' } }
```

### LOGGING_PATTERN
```ts
// SOURCE: 全仓库 src/ 无任何 console.* 调用，也无 logger 工具（唯一是 db/index.ts:18 的 Drizzle dev-only query log）。
// 不引入 logger。错误经具名 class + zod 向上冒泡；MCP 侧用 isError content 映射（register-tools.ts:39-59）。
// 报告的 Claude 调用失败：抛普通 Error（中文 message），由 action 冒泡给 UI。绝不 console.log 学生数据/密钥。
```

### DATA_ACCESS（唯一合法入口）
```ts
// SOURCE: src/db/tenant.ts:14-55 + src/app/dashboard/students/share-data.ts:39-58
const rows = (await forTenant(ctx).select(attendance,
  and(eq(attendance.studentId, studentId), inArray(attendance.lessonId, lessonIds)),
)) as (typeof attendance.$inferSelect)[]
// 空 inArray([]) 是非法 SQL → 先 early-return。tenantId 只来自 ctx，绝不来自参数。
```

### SERVICE / SERVER_ACTION_PATTERN
```ts
// SOURCE: src/app/dashboard/students/actions.ts:20-32
'use server'
export async function createReportDraft(input: CreateReportInput) {
  const ctx = await requireAuthContext()               // 1) 已验证 principal + tenant
  requirePermission(ctx, { report: ['create'] })       // 2) RBAC 置顶
  const data = createReportSchema.parse(input)         // 3) zod 校验/规范化
  // 4) 聚合 DB 数字 → Claude 起草叙述 → forTenant.insert（tenantId 注入）
  revalidatePath('/dashboard/reports')
  return row
}
// 门禁类返回可用 { ok, ... } 判别联合（mirror schedule/actions.ts 的 ScheduleResult）
```

### PURE_COMPOSER（可直测、无 DB/server-only）
```ts
// SOURCE: src/mcp/message.ts:11-32（纯函数、可像 composeParentMessage 一样单测）
export function buildReportPrompt(args: { rubricVersion: string; data: ReportData }): {
  system: string; userJson: string
} { /* 纯字符串组装，无副作用 */ }
```

### CLAUDE_CALL（server-only 直调，缓存 rubric）
```ts
// SOURCE: 新增，遵循 claude-api skill + env.ts:13-20 的 optional-env 范式
import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
const client = new Anthropic() // 读 ANTHROPIC_API_KEY；调用前先断言 env 存在
const res = await client.messages.create({
  model: env.ANTHROPIC_MODEL,          // 默认 claude-opus-4-8
  max_tokens: 2048,
  system: [{ type: 'text', text: RUBRIC[rubricVersion], cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content: userJson }], // 易变学生数据在 user turn
})
const narrative = res.content.filter(b => b.type === 'text').map(b => (b as any).text).join('')
// 不传 temperature/top_p/budget_tokens（opus-4.8 会 400）
```

### PDF_RENDER（免 Chromium + 内嵌 CJK）
```tsx
// SOURCE: 新增。@react-pdf/renderer renderToBuffer + Font.register 本地 .ttf
import { Document, Page, Text, View, Font, renderToBuffer } from '@react-pdf/renderer'
import path from 'node:path'
Font.register({ family: 'NotoSansSC',
  src: path.join(process.cwd(), 'public/fonts/NotoSansSC-Regular.ttf') }) // 本地路径，非 URL
export function renderReportPdf(model: ReportViewModel): Promise<Buffer> {
  return renderToBuffer(<ReportDocument model={model} />) // 数字来自 model（DB 渲染）
}
// 注意：Next 16/Turbopack 对静态导入 react-dom/server 报错（schedule-card-render.tsx:6-11）；
// @react-pdf 不走 react-dom/server，但若本组件被 App graph 静态引入报同类错，改动态 import()。
```

### ZIP_BATCH（buffer 收集 + safe 去重 + Response headers）
```ts
// SOURCE: src/app/api/export/section/[sectionId]/route.ts:19,55-104
function safe(name: string) { const c = name.replace(/[/\\:*?"<>|]/g,'_').trim(); return c.length?c:'student' }
const chunks: Buffer[] = []
const zip = new ZipArchive({ zlib: { level: 9 } })              // archiver@8 具名 class 导出
zip.on('data', (c: Buffer) => chunks.push(c))
const done = new Promise<Buffer>((res, rej) => { zip.on('end', () => res(Buffer.concat(chunks))); zip.on('error', rej) })
for (const s of students) { /* 顺序生成/取 approved 报告 PDF */ zip.append(pdf, { name: `${folder}/report.pdf` }) }
await zip.finalize(); const buf = await done                   // finalize 必在所有 append 之后
return new Response(new Uint8Array(buf), { status: 200, headers: {  // Uint8Array 满足 BodyInit
  'Content-Type': 'application/zip',
  'Content-Disposition': `attachment; filename="reports-${sectionId}.zip"`,
  'Cache-Control': 'private, no-store' } })
```

### TEST_STRUCTURE
```ts
// SOURCE: tests/schedule-card.test.ts:8-16,68 + tests/tenant-isolation.test.ts:9,26-53 + tests/mcp-tools.test.ts
// vitest.config.ts 已把 server-only 别名到空 stub、加载 dotenv/config、解析 @/* —— 新测试无需改配置。
const ctxFor = (tenantId:string, userId:string, role='owner'): AuthContext => ({ tenantId, userId, role, isPlatformAdmin:false })
// 纯测试：buildReportPrompt / 数据聚合切片 / can() 角色矩阵 / PDF 或 HTML 含 'Noto Sans SC'（防豆腐，mirror schedule-card.test:68）
// DB 集成：seed org/user/member(createdAt 必填) → forTenant 建行 → children-before-parents 幂等清理（beforeAll+afterAll 皆调）
// Claude 调用 vi.mock('@anthropic-ai/sdk') 返回固定文本，绝不打真实 API（DB 本身不 mock，打真实 Postgres）
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/db/schema/enums.ts` | UPDATE | 新增 `reportStatus = pgEnum('report_status', ['draft','approved'])` |
| `src/db/schema/progress-report.ts` | CREATE | `progressReport` 表（narrative/status/rubricVersion/model/period/approvedBy…） |
| `src/db/schema/index.ts` | UPDATE | `export * from './progress-report'` |
| `drizzle/000X_progress_report.sql` | CREATE | `npm run db:generate` 产出的迁移（勿手写） |
| `src/auth/permissions.ts` | UPDATE | statement 加 `report: ['create','read','list','update','approve']`；六角色矩阵填充 |
| `src/env.ts` | UPDATE | 加 optional `ANTHROPIC_API_KEY`（min 1）、`ANTHROPIC_MODEL`（默认 `claude-opus-4-8`） |
| `public/fonts/NotoSansSC-Regular.ttf` | CREATE | 内嵌中文字体（vendored，Font.register 用；仓库现无任何 .ttf） |
| `src/lib/report-data.ts` | CREATE | server-only：`getReportData(ctx, studentId, {from,to})` 聚合出勤/成绩/笔记（forTenant 骨架） |
| `src/lib/report-prompt.ts` | CREATE | **纯** composer：`buildReportPrompt` + `RUBRIC`（版本化常量，含“不得编造事实”） |
| `src/lib/report-draft.ts` | CREATE | server-only：`draftNarrative(data)` 调 `@anthropic-ai/sdk`（缓存 rubric、无危险参数） |
| `src/lib/report-pdf.tsx` | CREATE | `renderReportPdf(model)`：@react-pdf/renderer + Noto Sans SC；数字来自 model |
| `src/app/dashboard/reports/actions.ts` | CREATE | server actions：createReportDraft / updateReportNarrative / approveReport / listReports |
| `src/app/dashboard/reports/data.ts` | CREATE | 页面读数据（forTenant 列报告 + 学生下拉） |
| `src/app/dashboard/reports/page.tsx` | CREATE | 报告仪表盘（RSC）：学生选择 + 生成 + 列表 |
| `src/app/dashboard/reports/report-panel.tsx` | CREATE | 客户端交互：草稿编辑文本域、保存/批准、下载 PDF 链接 |
| `src/app/api/reports/[reportId]/pdf/route.ts` | CREATE | 单份 PDF 导出（鉴权，inline，`runtime='nodejs'`+`dynamic='force-dynamic'`） |
| `src/app/api/reports/section/[sectionId]/route.ts` | CREATE | 小班批量 approved 报告 ZIP（mirror export/section） |
| `src/app/dashboard/layout.tsx` | UPDATE | 导航加“报告”入口（若有 nav） |
| `package.json` | UPDATE | 加 `@anthropic-ai/sdk`、`@react-pdf/renderer` 依赖 |
| `package-lock.json` + `pnpm-lock.yaml` | UPDATE | 两个锁文件都同步（CI 用 `npm ci`；见 PR#4 教训） |
| `tests/report.test.ts` | CREATE | 纯（prompt/聚合/RBAC/字体）+ Claude-mock + DB 集成（draft→approve 生命周期） |

## NOT Building
- **报告数字快照冻结**：MVP 数字在渲染时从 DB 按 period 窗口直渲（period 确定即确定性）；不做 approval 时的 jsonb snapshot 冻结（后续按需）。
- **Message Batches API（省 50%）**：PRD 明确“量大再上”；MVP 单次同步调用。
- **BullMQ/Redis 后台队列**：批量走顺序循环（小班 ≤15 人），不引队列。
- **家长/学生查看报告门户**：Phase 7 登录门户范畴；MVP 报告仅教师端 + PDF 下载。
- **报告模板自定义/多模板**：单一固定模板。
- **PNG/图片版报告**：报告只出 PDF（微信卡片是 Phase 4 的 PNG，两码事）。
- **富文本/Markdown 叙述编辑器**：纯 textarea 编辑叙述文本。
- **成绩趋势图表**：MVP 只列数字与叙述，不画 chart。
- **MCP `draft_report` 工具**：可后续复用 `report-draft.ts`，不在本 Phase。

---

## Step-by-Step Tasks

### Task 1: 新增 report_status enum
- **ACTION**: 在 `src/db/schema/enums.ts` 末尾新增 enum。
- **IMPLEMENT**: `export const reportStatus = pgEnum('report_status', ['draft', 'approved'])`
- **MIRROR**: `enums.ts:14-20`（rescheduleStatus/paymentStatus 写法）。
- **IMPORTS**: 已有 `pgEnum`。
- **GOTCHA**: enum 值一旦上线难改；只放 draft/approved 两态。
- **VALIDATE**: `npm run typecheck`。

### Task 2: 建 progressReport 表
- **ACTION**: 新建 `src/db/schema/progress-report.ts`。
- **IMPLEMENT**: 列：`id=primaryId()`, `tenantId=tenantId()`, `studentId text notNull`, `sectionId text`(nullable), `title text`, `periodStart date`, `periodEnd date`, `narrative text`, `rubricVersion text notNull`, `model text`, `status reportStatus notNull default 'draft'`, `approvedBy text`, `approvedAt timestamptz`, `createdBy text`, `createdAt/updatedAt`。约束：`uniqueIndex('uq_report_tenant_id')`；组合 FK `(tenant,student)→student` `.onDelete('restrict')`、`(tenant,section)→classSection` `.onDelete('set null')`；index `(tenant,student)`、`(tenant,status)`、`(tenant,section)`。
- **MIRROR**: `grade.ts:17-58`（组合 FK + restrict + 覆盖 FK 的 index）、`reserved.ts:15-40`。
- **IMPORTS**: `pgTable,text,date,timestamp,index,uniqueIndex,foreignKey` from drizzle；`primaryId,tenantId,createdAt,updatedAt` from `./_helpers`；`reportStatus` from `./enums`；`student` from `./student`；`classSection` from `./course`。
- **GOTCHA**: FK 必须组合 `[tenantId, studentId]→[student.tenantId, student.id]`（单列 FK 会跨租户）。student/section 已各有 `uq_*_tenant_id` 作组合 FK 目标。
- **VALIDATE**: `npm run typecheck`。

### Task 3: 导出新表 + 生成迁移
- **ACTION**: `src/db/schema/index.ts` 加 `export * from './progress-report'`；跑 `npm run db:generate`。
- **MIRROR**: `index.ts:1-13`。
- **GOTCHA**: 迁移由 drizzle-kit 生成，**勿手写**；生成后 review SQL 确认 enum/表/FK/index 齐全。
- **VALIDATE**: `npm run db:generate` 无错误；git diff 检查 .sql。

### Task 4: RBAC — report statement + 角色矩阵
- **ACTION**: `src/auth/permissions.ts` 的 `statement` 加 `report`，填六角色。
- **IMPLEMENT**: `report: ['create','read','list','update','approve']`。owner/admin/teacher = 全部（含 approve）；assistant = `['read','list']`；parent/student = 无。
- **MIRROR**: `permissions.ts:14-67`（rescheduleRequest 分级授权）。
- **GOTCHA**: `Statements` 从 `statement` 推导，加字段后 `requirePermission(ctx,{report:['create']})` 即可用。
- **VALIDATE**: `npm run typecheck` + `can()` 断言（Task 12）。

### Task 5: 加 Anthropic env（optional）
- **ACTION**: `src/env.ts` server 段加两个 key。
- **IMPLEMENT**: `ANTHROPIC_API_KEY: z.string().min(1).optional()`；`ANTHROPIC_MODEL: z.string().min(1).default('claude-opus-4-8')`。
- **MIRROR**: `env.ts:13-20`（MCP 全 optional，app 无配置也能启动）。
- **GOTCHA**: optional 使容器构建（`SKIP_ENV_VALIDATION`）与未接 Claude 的部署都能启动；`report-draft.ts` 调用前检查 key，缺失抛中文错误。
- **VALIDATE**: `npm run typecheck`；无 key 时 `npm run build` 仍过。

### Task 6: 报告数据聚合（server-only）
- **ACTION**: 新建 `src/lib/report-data.ts`，导出 `getReportData(ctx, studentId, window)`。
- **IMPLEMENT**: `forTenant(ctx)` 取：该生 active enrollment 的 sectionId → 窗口内 lessons → attendance（按 status 计数 + 出勤率）；grade（窗口内分数列表 + 均分，`Number(row.score)` 解析）；note（供教师参考，prompt 里标注供 AI 概括）。返回结构化 `ReportData`（纯数字/字符串，PDF 与 prompt 复用）。**把纯计算（计数/均分）与 DB 查询分离**，便于单测切片。
- **MIRROR**: `share-data.ts:39-58`（跨表 forTenant 聚合 + 空 inArray early-return）。
- **IMPORTS**: `'server-only'`；`and,eq,inArray,gte,lte` from drizzle；schema 表；`AuthContext`。
- **GOTCHA**: `grade.score` 是 `numeric`→node-pg 返回 **string**，必 `Number()` 再算均值（grade.ts:26 注释）。空 enrollment → 空 inArray 非法 SQL，先 early-return。窗口用 `gte/lte(lesson.startAt, from/to)`。
- **VALIDATE**: 纯聚合函数 Task 12 单测。

### Task 7: 纯 prompt composer + 版本化 rubric
- **ACTION**: 新建 `src/lib/report-prompt.ts`（**纯**，无 server-only/DB）。
- **IMPLEMENT**: `RUBRIC_VERSION='v1'`；`RUBRIC: Record<string,string>`（中文进度报告写作规范，**明确“只可总结所给结构化数据，不得编造任何出勤率/成绩/事实；数字由系统另行渲染，你只写叙述”**）；`buildReportPrompt({rubricVersion,data}) => { system: RUBRIC[rubricVersion], userJson: JSON.stringify(data) }`。
- **MIRROR**: `src/mcp/message.ts:11-32`（纯 composer、可直测）。
- **GOTCHA**: rubric 放 `system` 且**版本化**（改 rubric 就 bump version）——利于缓存命中 + 报告可复现。userJson（易变）放 user turn。
- **VALIDATE**: Task 12 断言 system 含“不得编造”、userJson 含数字。

### Task 8: Claude 起草（server-only 直调）
- **ACTION**: 新建 `src/lib/report-draft.ts`，导出 `draftNarrative(data): Promise<{ narrative; model; rubricVersion }>`。
- **IMPLEMENT**: 检查 `env.ANTHROPIC_API_KEY`，缺失抛 `new Error('未配置 Claude API Key，无法起草报告')`；`buildReportPrompt` → `client.messages.create({ model: env.ANTHROPIC_MODEL, max_tokens: 2048, system:[{type:'text', text:system, cache_control:{type:'ephemeral'}}], messages:[{role:'user', content:userJson}] })`；`res.content.filter(b=>b.type==='text')` 拼接 narrative。
- **MIRROR**: `register-tools.ts` 鉴权/错误范式 + `claude-api` skill messages.create 形状。
- **IMPORTS**: `'server-only'`；`Anthropic from '@anthropic-ai/sdk'`；`buildReportPrompt,RUBRIC_VERSION`；`env`。
- **GOTCHA**: **绝不传** `temperature/top_p/budget_tokens`（opus-4.8→400）。`res.content` 联合类型须收窄。数字不交给 LLM。绝不 log 学生数据/key。
- **VALIDATE**: Task 12 `vi.mock('@anthropic-ai/sdk')`，断言组装正确、不打真实 API、缺 key 抛错。

### Task 9: PDF 渲染 + 内嵌 Noto Sans SC
- **ACTION**: vendored `public/fonts/NotoSansSC-Regular.ttf`；新建 `src/lib/report-pdf.tsx` 导出 `renderReportPdf(model): Promise<Buffer>`。
- **IMPLEMENT**: 模块级 `Font.register({ family:'NotoSansSC', src: path.join(process.cwd(),'public/fonts/NotoSansSC-Regular.ttf') })`；`ReportDocument`：页眉学生名/窗口、出勤统计表（**数字来自 model**）、成绩表、AI 叙述段、页脚（生成时间 + draft/approved 徽标）；`renderToBuffer(<ReportDocument model={model}/>)`。
- **GOTCHA**: **必须内嵌本地 .ttf**——Google Fonts URL 或系统 .ttc 会静默豆腐（PRD H 级风险；仓库现无 .ttf，Docker 的 fonts-noto-cjk 只服务 Playwright）。`process.cwd()/public/fonts` 在 Next standalone 产物里可读；若未含则改 `src/assets/fonts` 并在 `next.config` `outputFileTracingIncludes` 显式纳入。消费路由 `export const runtime='nodejs'`。上线前用真实中文名逐面验证。
- **VALIDATE**: 手动生成含中文名 PDF 打开检查（Manual Validation）。

### Task 10: 报告 server actions
- **ACTION**: 新建 `src/app/dashboard/reports/actions.ts`。
- **IMPLEMENT**:
  - `createReportDraft({studentId,sectionId?,periodStart,periodEnd,title?})`：requireAuthContext → `requirePermission(ctx,{report:['create']})` → zod parse（`periodEnd≥periodStart` refine）→ `getReportData` → `draftNarrative` → `forTenant.insert(progressReport,{...,narrative,rubricVersion,model,status:'draft',createdBy:ctx.userId})` → revalidate。
  - `updateReportNarrative(id,narrative)`：`requirePermission(ctx,{report:['update']})`；**仅 status==='draft'** 可改（approved 抛错）→ `forTenant.update`。
  - `approveReport(id)`：`requirePermission(ctx,{report:['approve']})` → 校验 draft → `forTenant.update(...,{status:'approved',approvedBy:ctx.userId,approvedAt:new Date()})`。
  - `listReports(studentId?)`：`requirePermission(ctx,{report:['list']})` → forTenant.select。
- **MIRROR**: `students/actions.ts:20-73`（骨架 + revalidatePath）；门禁返回可 mirror `ScheduleResult` 判别联合。
- **GOTCHA**: approved 不可再改；tenantId 只来自 ctx。
- **VALIDATE**: DB 集成 draft→update→approve→拒绝再改（Task 12）。

### Task 11: UI — 报告仪表盘
- **ACTION**: 新建 `data.ts`（读）、`page.tsx`（RSC）、`report-panel.tsx`（client）；`dashboard/layout.tsx` 加导航。
- **IMPLEMENT**: page 列本租户报告 + 学生下拉；panel：选学生+窗口→“生成草稿”；卡片：draft 显可编辑 textarea + [保存][批准]，approved 显只读 + 徽标；恒显 [下载 PDF]（`/api/reports/{id}/pdf`）；[批量导出 ZIP]（`/api/reports/section/{sectionId}`）。
- **MIRROR**: `dashboard/students/page.tsx` + `students/export-panel.tsx`/`student-form.tsx`。
- **GOTCHA**: 客户端组件 `'use client'`；下载/ZIP 用 `<a href>` 触发路由（非 fetch，符合 export-panel 现状）。
- **VALIDATE**: `npm run build`；浏览器手测。

### Task 12: 测试
- **ACTION**: 新建 `tests/report.test.ts`。
- **IMPLEMENT**:
  - **纯**：`buildReportPrompt`（system 含“不得编造事实”、userJson 含数字）；report-data 纯聚合切片（含 `numeric` string→均分）；`can()` 矩阵（owner/teacher create+approve；assistant read/list 不可 approve；parent 不可 read report）；PDF/或其 HTML 层含 `'Noto Sans SC'`（防豆腐，mirror `schedule-card.test.ts:68`）。
  - **Claude mock**：`vi.mock('@anthropic-ai/sdk')` 固定文本，断言组装正确、不打真实 API、缺 key 抛错。
  - **DB 集成**：seed org/user/member+student+section+attendance/grade → createReportDraft(mock Claude)→ status='draft' → updateReportNarrative → approveReport → 断言 approved 后再 update 抛错。children-before-parents 幂等清理。
- **MIRROR**: `tests/mcp-tools.test.ts:1-54,166-283` + `tests/tenant-isolation.test.ts:9,26-53` + `tests/schedule-card.test.ts:68`。
- **GOTCHA**: DB 集成需真实 Postgres；纯测试须始终全绿。Claude 一律 mock。清理顺序：report→grade→attendance→lesson→enrollment→section→course→student→member→org→user。
- **VALIDATE**: `npm test`（非 DB 套件全绿；有 Postgres 时 DB 套件全绿）。

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| buildReportPrompt 含防幻觉指令 | rubricVersion='v1', data | system 含“不得编造事实”；userJson 含数字 | — |
| 聚合出勤率 | 4 present/1 absent | rate=80%，计数正确 | — |
| numeric string 均分 | score='85.00','90.00' | avg=87.5（Number 解析） | ✓ 类型坑 |
| 空 enrollment 聚合 | 无 active enrollment | 空聚合，不抛（early-return） | ✓ 空 inArray |
| PDF/HTML 含 CJK 字体族 | 渲染任意报告 | 含 'Noto Sans SC' | ✓ 防豆腐 |
| can(owner, report:create/approve) | 'owner' | true | — |
| can(assistant, report:approve) | 'assistant' | false | ✓ 分级 |
| can(parent, report:read) | 'parent' | false | ✓ 家长无权 |
| draftNarrative 缺 key | key unset | 抛中文错误，不打 API | ✓ 未配置 |
| approveReport 后 update | approved 报告 | 抛“已定稿不可修改” | ✓ 门禁 |
| 跨租户读报告 | 他租户 reportId | findById 返回 null | ✓ 隔离 |

### Edge Cases Checklist
- [ ] 空输入：无出勤/成绩/笔记 → 报告可生成（叙述“暂无记录”类）
- [ ] 最大：15 人小班批量 ZIP → 顺序完成、每份仅含该生
- [ ] 无效类型：periodEnd < periodStart → zod 拒绝
- [ ] 并发：react-pdf renderToBuffer 无共享可变状态（无需 Playwright 互斥）；Claude 无令牌竞态
- [ ] 网络失败：Claude API 报错 → 抛中文错误冒泡，不写库
- [ ] 权限拒绝：assistant 点批准 → FORBIDDEN；家长无报告入口

---

## Validation Commands

### Static Analysis
```bash
npm run typecheck
npm run lint
```
EXPECT: 零类型错误、零 lint 错误

### Unit Tests
```bash
npm test
```
EXPECT: 非 DB 套件全绿（prompt/聚合/RBAC/字体/Claude-mock）；有 `DATABASE_URL` 时 DB 集成全绿

### Full Build
```bash
npm run build
```
EXPECT: 无 key 也能构建成功（env optional）；无回归

### Database Validation
```bash
npm run db:generate   # 应产出 progress_report 迁移
npm run db:migrate    # 有 Postgres 时应无错误
```
EXPECT: report_status enum + progress_report 表 + FK/index 到位

### Browser Validation
```bash
npm run dev
# 访问 /dashboard/reports
```
EXPECT: 生成草稿 → 编辑叙述 → 批准 → 下载 PDF 中文不豆腐；批量 ZIP 每份仅含对应学生

### Manual Validation
- [ ] 用**真实中文学生名**生成一份 PDF，打开确认无豆腐、数字与 DB 一致
- [ ] 草稿可编辑并保存；批准后叙述锁定为只读
- [ ] assistant 看不到/点不了“批准”；家长无报告入口
- [ ] 未配置 ANTHROPIC_API_KEY 时“生成草稿”给出清晰中文报错，app 其余功能正常
- [ ] 15 人小班 ZIP：解压后每个文件夹仅含该生 report.pdf

---

## Acceptance Criteria
- [ ] 所有 Task 完成
- [ ] 所有 Validation 命令通过
- [ ] 测试已写且通过（纯套件全绿）
- [ ] 无类型错误、无 lint 错误
- [ ] PDF 中文渲染无豆腐、数字与 DB 一致（Success signal）
- [ ] draft→approved 门禁生效，approved 不可改
- [ ] 小班批量 ZIP 每份仅含对应学生

## Completion Checklist
- [ ] 代码遵循 forTenant / requirePermission / zod / revalidatePath 既有范式
- [ ] 错误处理用具名 class + 中文 message 冒泡（无 logger）
- [ ] 无硬编码 tenant/model（tenant 来自 ctx，model 来自 env）
- [ ] Claude 只写叙述、数字从 DB 渲染、prompt 含“不得编造事实”
- [ ] 密钥/学生数据绝不进日志
- [ ] 迁移由 drizzle-kit 生成（未手写）
- [ ] 无越权：报告受 report RBAC 约束，家长/学生 MVP 无权
- [ ] 两个锁文件同步（npm + pnpm）
- [ ] 自包含——实现期无需再搜代码或提问

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| 中文在 PDF 里豆腐 | M | H | 内嵌本地 Noto Sans SC .ttf + Font.register 本地路径；上线前真实中文名逐面验证；standalone 产物确认字体被打包 |
| LLM 把出勤/成绩幻觉进叙述 | M | H | 数字 PDF 侧从 DB 直渲，prompt 明确“只总结所给数据、不得编造”，教师审核门禁 |
| react-pdf 字体在 Next standalone 未打包 → 运行时找不到 | M | M | 放 `public/fonts` 并 `process.cwd()` 读；必要时 next.config `outputFileTracingIncludes` 显式纳入；`runtime='nodejs'` |
| Anthropic key 泄露/进日志 | L | H | key 走 env（optional）、绝不 console.log、绝不入报告表；缺失时 fail-fast 中文报错 |
| 依赖新增致锁文件不同步 CI 失败 | M | M | 同步更新 `package-lock.json` 与 `pnpm-lock.yaml`（CI 用 npm ci，PR#4 教训）；本地 `npm ci` 验证 |
| approved 报告数字随后续 DB 变化而漂移 | L | M | period 窗口确定即数字确定；如需绝对冻结，后续加 jsonb snapshot（已列 NOT Building） |

## Notes
- **模型选择**：默认 `claude-opus-4-8`（claude-api skill 强制默认）。报告叙述是低难度总结任务，教师若想降本可在 env 改 `ANTHROPIC_MODEL=claude-haiku-4-5` 或 `claude-sonnet-5`——把选择权交给部署者，不在代码里擅自降档。
- **合规**：`src/app/privacy/page.tsx:47` 已对家长预告“课程报告可能借助 Claude API 辅助起草”，PIPL 告知已就位，无需新增文案。
- **Claude 调用是单次同步无工具调用**——不是 agent/MCP/draft-and-confirm 令牌流；借用其鉴权与“教师门禁”思路，技术上是 `@anthropic-ai/sdk` server-only 直调。
- **测试基建**：`vitest.config.ts` 已把 `server-only` 别名到空 stub、加载 `dotenv/config`、解析 `@/*`；新增 `tests/report.test.ts` 无需改配置；DB 测试打真实 Postgres（不 mock DB），仅 mock `@anthropic-ai/sdk`。
