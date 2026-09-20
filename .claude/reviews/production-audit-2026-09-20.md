# 生产就绪审计报告 · Course Scheduling System

> **生产审计：67 / 100 — Risky（谨慎发布）**
> 认证 / 多租户 / 公开 token / MCP / AI 五大安全面**零确认漏洞**（本次审计最反直觉的结论）；分数被一条已确认的部署 crash-loop（升级路径）+ 运维空白（无经测试的回滚/恢复手册、盲健康检查、无安全响应头）+ 未成年人 PII 无同意闸门流向第三方/中国区 LLM 拖住。**支付维度不适用（无 Stripe）。**

| 项 | 值 |
|---|---|
| 审计日期 | 2026-09-20 |
| 提交基线 | `1fabb8d` (main, = origin/prod/ithaca) |
| 应用版本 | `course-scheduler` 0.1.0 |
| 栈 | Next.js 16 (App Router / React 19 / standalone) · PostgreSQL 17 + Drizzle · Better Auth 1.7 · Docker + docker-compose + Coolify |
| 方法 | 9 风险维度并行静态+结构审阅 → 每条 critical/high 发现独立对抗性验证；200 次工具调用 |
| 结果 | 35 条发现：**1 确认 HIGH** · 13 medium · 21 low/info · 0 critical · 0 被推翻 |

---

## 1. 评分依据

评分卡硬顶规则被触发，将分数压到 69 以下：

- **cap-at-69 触发**：「高影响发布无回滚路径」——迁移仅向前（`./drizzle` 无 down migration），无经端到端验证的 restore-from-backup / PITR runbook。
- **cap-at-84 不适用**：CI 覆盖了上线关键路径（构建生产镜像 → 迁移 → vitest 租户隔离套件 → health smoke → 全量 Playwright E2E 覆盖登录/仪表盘/门户/分享链接）。无证据表明 CI 当前为红。

未触发的 cap-at-69 条件（即强项）：认证/授权在敏感数据上**齐备**；支付 webhook 幂等性 N/A；密钥**未**泄漏到客户端包/日志/提交文件。

> **情境修正**：若这是**全新 DB 首发**，迁移 0016 可干净应用（无孤儿行），实际风险显著低于分数体感。67 分主要为「第二次及以后的部署」与「承接真实客户数据」把关。

---

## 2. Blockers（部署前必修）

### B1 · 迁移 0016 在存在孤儿 tenant_id 的库上 crash-loop 容器 — ✅ 对抗性确认（HIGH）

- **位置**：`docker/entrypoint.sh:4`、`drizzle/0016_tenant_id_fk.sql:8`
- **链条**：`entrypoint.sh:2` 设 `set -e` → `:4` 跑 `node /app/dist/migrate.mjs` → 0016 一次性 `ADD CONSTRAINT ... FOREIGN KEY (tenant_id) REFERENCES public.organization(id) ON DELETE restrict`（18 张表，**无 `NOT VALID`**）→ 任一行 `tenant_id` 无对应 organization → Postgres 报 **23503** → `migrate.ts` `process.exit(1)` → `set -e` 中止 entrypoint（在 `exec node /app/server.js` 之前）→ **容器永久 crash-loop，永不 serve**。
- **孤儿行为何真实可达**：0016 之前 `tenant_id` 上无 FK（正是该迁移存在的原因）；Better Auth org 插件的删除路径（`src/auth/auth.ts:75` 加载时未禁用 `/api/auth/organization/delete`）不会级联到应用表。任何曾丢过一个组织、或被直接操作过的库都会带孤儿行。
- **补救脚本未接线**：`scripts/cleanup-orphan-tenants.ts` 是独立 `npx tsx` 工具，**未**被 entrypoint 调用；恢复依赖运维部落知识。与已知的 `ADMIN_PASSWORD<16` crash-loop 同一类静默部署炸弹。
- **验证结论（CONFIRMED / severity=high）**：每个机械环节均真实、无任何缓解守卫；搜遍 `src/` 无组织删除自动清理路径、无 boot 时守卫。定为 HIGH 而非 critical，仅因它只在「已积累孤儿行的存量库升级」时触发（全新装零行、干净应用）；一旦触发即全量、不自愈的宕机。
- **修复**：在 entrypoint migrate **之前**自动跑 `cleanup-orphan-tenants.ts`（幂等、共用同一 advisory lock），或把 0016 改为 `NOT VALID` 加约束 + 后续单独 `VALIDATE`。

### B2 · 无回滚 / 恢复 / 事故手册，迁移仅向前 — 触发评分硬顶

- **位置**：`docker/entrypoint.sh:4`
- **问题**：每次容器启动跑向前迁移；`./drizzle` 无 down migration；README 部署段记了推送部署与 S3 备份，但**无回滚流程、无 restore-from-backup runbook、无 PITR 步骤、无 on-call/事故流程**。若某次部署带上破坏性/有 bug 的迁移（drop/rename 列、坏 backfill），回滚镜像**不会**回滚 schema，旧代码将跑在新 schema 上，唯一恢复是未文档化的手动 PITR。
- **修复**：端到端验证 S3 恢复、写 PITR/回滚/事故手册；对迁移强制 expand/contract 向后兼容纪律（新版本迁移必须兼容上一版本代码）。

---

## 3. High-value fixes（提分 / 降险；均为 medium，未做独立对抗验证但带 verbatim 证据）

| # | 维度 | 严重度 | 问题 | 位置 |
|---|---|---|---|---|
| H1 | 运维/可观测 | medium | 健康检查是静态 `{ok:true}`，**不探 DB**——DB 挂了编排仍显示绿，Traefik 继续打流量，容器永不重启/自愈 | `src/app/api/health/route.ts:4` |
| H2 | Web 加固 | medium | **零安全响应头**（无 CSP / HSTS / X-Frame-Options / nosniff / Referrer-Policy），仅两条分享路由有 X-Robots-Tag；staff Server Actions 可被 iframe 点击劫持，微信内浏览器首访可被 HTTP→HTTPS 降级 MITM | `next.config.ts:21` |
| H3 | 隐私合规 | medium | 未成年人真名+年级+评语+shared 笔记原文**无同意闸门、无脱敏**发往 Anthropic；`REPORT_PROVIDER=minimax` 时发往 `api.minimaxi.com`（中国大陆端点）。PIPEDA 口径下的跨境个资/超额留存风险 | `src/lib/report-data.ts:99` |
| H4 | 可用性/DoS | medium | LLM 调用**无 timeout / AbortController / maxRetries 覆盖**，SDK 默认 ~10min × 3 次重试；同步跑在 server action 里，几个并发起草即可耗尽请求并发、拖垮整站 | `src/lib/report-draft.ts:39,64` |
| H5 | 纵深防御 | medium | **无 Postgres RLS 兜底**，多租户全靠「每处都记得 `forTenant()`」；一个未来的 raw `db.select().from(tenantTable)` 即静默跨租户读写。ADR 0001 自述的 revisit 触发器「真实客户数据落地」已到 | `src/db/tenant.ts:22` |
| H6 | 访问控制 | medium | 分享/日历 token **永不过期**（`shareLink`/`sectionShareLink`/`calendarFeed` 均无 `expiresAt`，仅 `isNull(revokedAt)`）；经微信/二维码转发即永久暴露孩子姓名/课表/地点；whole-tenant 日历 feed 令牌泄漏暴露全机构课表 | `src/db/schema/share-link.ts:16` |
| H7 | 事务边界 | medium | 改期审批 claim→move→notify **非原子**：claim 提交后崩溃 / `releaseClaim()` 抛错 → 请求卡在 `approved` 但课未移，且所有复核路径守 `status='pending'`，**永远无法恢复** | `src/lib/reschedule-core.ts:145` |
| H8 | 数据生命周期 | medium | 0016 的 18 条 RESTRICT FK 后，**删除有数据的组织不可能**，且无 purge 例程（grep `deleteOrganization/purgeTenant` 无实现）；合法的租户下线/擦除需手写有序 SQL | `drizzle/0016_tenant_id_fk.sql:6` |
| H9 | 前端恢复 | medium | 越权 staff 直达无权页 → `requirePermission` 抛 `AuthError('FORBIDDEN')` → 落到通用 `dashboard/error.tsx`，「重试」按钮 `reset()` 立即再抛 = **死循环**，且被误导为瞬时错误 | `src/app/dashboard/schedule/page.tsx:9`、`src/auth/authorize.ts:16` |
| H10 | 前端恢复 | medium | portal 与 (auth) 段**无 error.tsx**（仅 dashboard 有）；一次 DB 抖动 → 冒泡到 `global-error.tsx` 替换整个文档，门户用户（最不技术的家长/学生）丢失整个应用外壳 | `src/app/portal/layout.tsx:24` |
| H11 | 暴力破解 | medium | 登录 `/sign-in/email` 仅靠 better-auth 默认内存限流（按 IP、重启即清、多实例碎片化）；**无按账号锁定**；配合 8 位口令下限使在线爆破可行 | `src/auth/auth.ts:11` |
| H12 | 凭据爆破半径 | medium | MCP 静态 bearer 映射到固定 owner 级主体（读+写全租户），**无过期、无轮换机制、无 per-tool scope**；一次泄漏 = 该租户全量读写 + 批量 PII 外泄（`list_students` 返回每个学生 `parentWechat`） | `src/auth/mcp-context.ts:29`、`src/mcp/register-tools.ts:140` |

**建议优先级**：先做 B1 + H1 + H2（一次 draft PR，均为低风险高收益）；H3/H4 属 AI 链路，建议一并处理；H5 可先落 CI grep 守卫（低成本），RLS 作为后续里程碑。

---

## 4. 全部发现清单（按维度）

图例：✅=对抗性确认 · ▫=未独立验证（带 verbatim 证据）

### 4.1 认证与授权（auth-authz）— 4 条
| 严重度 | 标题 | 位置 |
|---|---|---|
| medium ▫ | 凭据登录无按账号锁定/限流（见 H11） | `src/auth/auth.ts:11` |
| low ▫ | 所有 staff/门户账号口令下限仅 8 位（仅超管硬化到 16） | `src/auth/provision.ts:27`、`staff.ts:28`、`account-actions.ts`、`password.ts` |
| low ▫ | MCP 静态 bearer 映射全 owner 级租户上下文（读+写） | `src/app/api/[transport]/route.ts:25` |
| low ▫ | `SKIP_ENV_VALIDATION` 在**运行期** env 存在时会绕过密钥强度校验（BETTER_AUTH_SECRET/ADMIN_PASSWORD/CRON_SECRET 等） | `src/env.ts:78` |

### 4.2 多租户隔离（tenant-isolation）— 3 条
| 严重度 | 标题 | 位置 |
|---|---|---|
| medium ▫ | 无 Postgres RLS 兜底，隔离仅靠文档约束（见 H5） | `src/db/tenant.ts:22` |
| low ▫ | `getAuthContext` 的 null-activeOrg 回退对多组织用户用 `.limit(1)` 无 `ORDER BY`，可落入非预期租户+角色 | `src/auth/context.ts:49` |
| low ▫ | staff 停用/复用翻转**全局** `user.banned`，对多组织用户跨组织越界（A 组织停用 → B 组织也被锁） | `src/auth/staff.ts:157` |

### 4.3 公开 token 路由（public-token-routes）— 3 条
| 严重度 | 标题 | 位置 |
|---|---|---|
| medium ▫ | 分享/feed token 永不过期（无 `expiresAt`）——指向未成年人 PII 的永久能力链接（见 H6） | `src/db/schema/share-link.ts:16` |
| low ▫ | 已吊销 ICS feed 仍从私有缓存服务最多 1h（`max-age=3600, must-revalidate`） | `src/app/api/calendar/[token]/route.ts:36` |
| low ▫ | `/s` `/sec` HTML 分享页设了 noindex 但**无** `Cache-Control: private/no-store`（与其余同类数据不一致） | `src/app/s/[token]/page.tsx:12` |

### 4.4 MCP / cron 机器鉴权（mcp-cron）— 4 条
| 严重度 | 标题 | 位置 |
|---|---|---|
| medium ▫ | MCP 静态 bearer 固定 owner 级主体、广 PII/写权、无轮换/过期（见 H12） | `src/auth/mcp-context.ts:29` |
| low ▫ | MCP audience（confused-deputy）校验可选且默认关（`MCP_RESOURCE_URL` optional，未设即 no-op 且无告警） | `src/app/api/[transport]/route.ts:30` |
| low ▫ | 内存版 confirm store（`Map`）非重启/多实例安全——redeploy 之间的 preview→confirm 静默失效 | `src/lib/mcp-confirm.ts:14` |
| low ▫ | MCP/cron 鉴权端点无限流（残余风险为请求洪泛 DoS，非凭据恢复） | `src/app/api/[transport]/route.ts:19` |

### 4.5 AI 报告起草（ai-report-surface）— 4 条
| 严重度 | 标题 | 位置 |
|---|---|---|
| medium ▫ | 未成年人 PII 无同意/脱敏发往第三方（含中国区 MiniMax）LLM（见 H3） | `src/lib/report-data.ts:99` |
| medium ▫ | LLM 调用无 timeout/AbortController，hung provider 阻塞 server action 数分钟（见 H4） | `src/lib/report-draft.ts:39` |
| low ▫ | prompt 输入无总量上限——单次起草可达 ~400KB 笔记文本（token 成本放大） | `src/lib/report-data.ts:86` |
| low ▫ | shared 笔记体经 prompt 注入（**已充分缓解**，仅纵深防御记录；输出纯文本渲染，无 XSS sink） | `src/lib/report-prompt.ts:69` |

### 4.6 数据完整性 / 迁移（data-integrity）— 4 条
| 严重度 | 标题 | 位置 |
|---|---|---|
| **high ✅** | **迁移 0016 在孤儿 tenant_id 上 crash-loop 容器（见 B1）** | `docker/entrypoint.sh:4` |
| medium ▫ | 改期审批 claim→move 非原子，崩溃后卡 approved 无法恢复（见 H7） | `src/lib/reschedule-core.ts:145` |
| medium ▫ | 0016 后删除有数据组织不可能且无 purge 例程（见 H8） | `drizzle/0016_tenant_id_fk.sql:6` |
| low ▫ | `section_share_link`(0017) 带 tenant_id 但缺到 organization 的 FK（与 0016 策略不一致） | `drizzle/0017_even_agent_brand.sql:2` |

### 4.7 运维与部署（operations）— 4 条
| 严重度 | 标题 | 位置 |
|---|---|---|
| medium ▫ | 健康检查静态 `{ok:true}`，不验证 DB 可达（见 H1） | `src/app/api/health/route.ts:4` |
| medium ▫ | 无回滚/迁移回滚/事故手册，仅向前迁移每次启动应用（见 B2） | `docker/entrypoint.sh:4` |
| low ▫ | 滚动部署期 boot 迁移可打断仍在服务的旧容器（schema/code skew 窗口） | `docker/entrypoint.sh:4` |
| low ▫ | app 容器在 `0.0.0.0` 暴露 3000（Postgres 却仅 loopback）；无主机防火墙时明文 HTTP 可直达 | `docker-compose.yml:73` |

### 4.8 输入校验 / Web 加固（input-validation）— 5 条
| 严重度 | 标题 | 位置 |
|---|---|---|
| medium ▫ | 无任何安全响应头（CSP/HSTS/X-Frame-Options/nosniff/Referrer-Policy）（见 H2） | `next.config.ts:21` |
| low ▫ | 重型 Chromium PNG/ZIP 导出路由无限流（单 mutex 后队列无界，可拖垮全体导出） | `src/app/api/export/student/[studentId]/png/route.ts:22` |
| low ▫ | MCP 工具错误兜底回传原始内部错误消息（CWE-209，泄漏 DB 表/列/约束细节） | `src/mcp/register-tools.ts:68` |
| low ▫ | 批量报告 ZIP 导出缺 PNG 侧已有的 `MAX_EXPORT_STUDENTS` 上限 | `src/app/api/reports/section/[sectionId]/route.ts:59` |
| info ▫ | 登录爆破防护仅靠 better-auth 默认（内存/单进程）——多实例化时失效 | `src/auth/auth.ts:11` |

### 4.9 上线关键 UX（frontend-ux）— 4 条
| 严重度 | 标题 | 位置 |
|---|---|---|
| medium ▫ | 越权页 FORBIDDEN 渲染成通用错误 + 死循环重试（见 H9） | `src/app/dashboard/schedule/page.tsx:9` |
| medium ▫ | portal/(auth) 段无 error.tsx，渲染失败炸掉整个应用外壳（见 H10） | `src/app/portal/layout.tsx:24` |
| low ▫ | portal/dashboard 根/auth 段无 loading.tsx，慢 RSC 导航无反馈（移动端体感卡死） | `src/app/portal/page.tsx:9` |
| low ▫ | 表单 14px 文本无 16px 下限——iOS Safari 聚焦时自动缩放（首屏登录/改期表单） | `src/app/(auth)/login/page.tsx:34` |

---

## 5. 已验证强项（保持不要退化）

- **多租户脊柱扎实**：`forTenant(ctx)` 是唯一 tenant-scoped 入口；insert 从已验证 AuthContext 注入 tenantId，update/delete 剥离 tenantId；复合 `(tenant_id, fk)` → `(tenant_id, id)` 外键做 DB 级跨租户引用完整性。审阅的所有代码路径无一处漏 tenant 过滤。
- **RBAC 不可绕过**：每个 server action / route handler / data loader 独立经 `getAuthContext`（`disableCookieCache:true` 实时重推角色与封禁/降权，5min cookie 缓存被绕过）+ `requirePermission`；layout 明确仅 UX；data loader 对门户角色返回 `[]`。分级 staff 管理正确（`assertCanManageRole` 保留 admin/owner 给超管、禁止自我改角色/提升到 owner、last-usable-owner 行锁事务内不变量 B39）；自我目标 admin 操作显式拦截。
- **注册确已多层关闭**：`disableSignUp` + `allowUserToCreateOrganization:()=>false` + `organizationLimit:0` + 客户端移除 organizationClient；门户角色无任何 org/member 语句。
- **公开 token**：nanoid(32) ≈ 190 bit + 全局唯一索引 + 精确匹配 miss 返 404，枚举不可行；tenant/资源严格从 token 行解析，不信任请求参数；已鉴权导出按 `actorOwnsSection/actorOwnsStudent` 校验且 404（非 403）防存在性探测。
- **MCP/cron**：`timingSafeEqual` 等长常量时间比较、fail-closed；MCP 主体固定自服务端 env、`isPlatformAdmin` 硬编码 false、角色实时重推；写操作有 SHA-256 payload-bound 单次 confirm 令牌闸门（TTL + 二次冲突检测）；提醒发送靠 per-(lesson,offset,startAt,user) 唯一约束幂等。
- **AI 报告**：数字由 DB 层独立计算渲染入 PDF（模型改不了事实）；prompt injection 纵深防御（仅 shared 笔记入 prompt + 围栏 STUDENT_DATA 块 + rubric v3 #7/#8 + 教师 draft→approve 闸门）；输出在 PDF（`<Text>` 转义）与门户/仪表盘（`whitespace-pre-wrap`，无 `dangerouslySetInnerHTML`/markdown/latex）**纯文本渲染，无 XSS sink**；单一 `sanitizeNarrative` 出口 + `validateNarrative` 拒空/拒 refusal，覆盖含 `<think>` 剥离的所有 provider；API key 从校验 env 读取，不入日志。
- **并发正确性**：教师(0001)/教室(0015) 双订用 GiST EXCLUDE 约束兜底，写路径捕获 23P01 转软 `ConflictError`；物化 `onConflictDoNothing`；通知 dedupe 用 partial unique index + 23505 兜底；改期状态用 guarded compare-and-set；SEC5 配额用事务级 advisory lock + re-count；`migrate.ts` 用 session advisory lock + drizzle 单事务（失败干净回滚）。
- **SSRF 防护**：Web Push 端点 allow-list 精确 host + 拒私网/loopback/link-local/云元数据，subscribe 与 send 两处双重校验；PNG/ZIP 导出用 `page.setContent`（从不导航到远端 URL），默认开 Chromium 沙箱。
- **配置/密钥卫生**：env 运行期 fail-fast 校验；`.dockerignore` 排除 `.env*`，仅安全 `NEXT_PUBLIC_*` 入客户端包；compose 用 `${VAR:?}` 拒缺失密钥启动；容器以非 root `nextjs` 运行；Postgres 仅 loopback。

---

## 6. 审计元信息

**Evidence checked**：`git status`/`git log`；`package.json`；`src/env.ts`、`.github/workflows/ci.yml`、`src/app/api/health/route.ts`；全量 `src/auth/*`、`src/db/tenant.ts`+schema、`src/lib/*-core.ts` 及 `share/ical-feed/report-*/reschedule/materialize/conflict/rate-limit/browser/push-*/errors`、公开 token 路由（`/s`、`/sec`、`/api/calendar`）、`api/[transport]`+`mcp/register-tools`、`api/cron/reminders`、`api/export/**`、`api/reports/**`、`drizzle/0001-0017` + `scripts/migrate.ts`+`cleanup-orphan-tenants.ts`、`docker/entrypoint.sh`、`Dockerfile`、`docker-compose.yml`、`dev.sh`、`next.config.ts`、`docs/adr/0001-0002`、前端布局/error/loading 边界与登录/门户页面。（9 维度并行审阅 + 对 HIGH 独立对抗验证；共 200 次工具调用。）

**Evidence missing（补上会改变置信度）**：
1. main 当前 CI 是否为绿（未实跑 pipeline）。
2. Coolify 用滚动还是 stop-then-start 部署（决定迁移/代码 skew 窗口与 B2/4.7-low 风险）。
3. 组织入驻是否已捕获 LLM/跨境个资同意（影响 H3 定性）。
4. 未实际驱动运行中的应用观察行为（本次为纯静态 + 结构审计）。
5. 13 条 medium 未做独立对抗验证（均带 verbatim 证据 + file:line，可信但未二次核实）。

**Next action**：先修 **B1** —— 把 `scripts/cleanup-orphan-tenants.ts` 接进 `docker/entrypoint.sh` migrate 之前（一行改动、幂等、共用 advisory lock、零风险），消除升级期 crash-loop。可与 **H1**（健康检查探 DB）+ **H2**（全局安全响应头）打包为一个 draft PR。

---

*审计方法：9 风险维度并行静态审阅（Opus 4.8）→ 对每条 critical/high 发现做对抗性验证（要求验证者尽力 REFUTE，默认怀疑）。本报告为工程分诊，非法律/合规认证。*
