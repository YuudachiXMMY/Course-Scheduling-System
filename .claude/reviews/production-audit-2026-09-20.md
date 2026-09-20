# 生产就绪审计报告 · Course Scheduling System

> **生产审计：74 / 100 — Launchable with Caveats（可带风险发布）** · *2026-09-20 修订：补充 IthacaServer 部署证据后由 67 上调*
> 认证 / 多租户 / 公开 token / MCP / AI 五大安全面**零确认漏洞**。部署证据（IthacaServer）显示回滚/备份/恢复工具链、Traefik 边缘安全头与限流中间件均已就位——原「无回滚路径」硬顶解除、H2/网络暴露等发现被推翻或降级。剩余把关项：一条升级期迁移 crash-loop（B1，全新部署不触发）、安省未成年人 PII 跨境流向中国区 LLM（H3，安省 PIPEDA）、LLM 无超时（H4）、健康检查不探 DB（H1）。**支付维度不适用（无 Stripe）。**

| 项 | 值 |
|---|---|
| 审计日期 | 2026-09-20（部署证据修订同日） |
| 提交基线 | `1fabb8d` (main, = origin/prod/ithaca) |
| 应用版本 | `course-scheduler` 0.1.0 |
| 栈 | Next.js 16 (App Router / React 19 / standalone) · PostgreSQL 17 + Drizzle · Better Auth 1.7 |
| 部署 | **IthacaServer**（单 VPS · Traefik+TLS 反代 · per-app Linux 用户隔离 · git-source `ops deploy` = compose recreate · `ops backup/restore/rollback` + 备份新鲜度 cron）· 域名 `dashboard.ithacateens.com`（安省组织 Ithaca Teens） |
| 方法 | 9 风险维度并行静态+结构审阅 → 每条 critical/high 发现独立对抗性验证；200 次工具调用 + 部署参考核对 |
| 结果 | 35 条发现 · **1 确认 HIGH** · 12 medium · 20 low/info · 0 critical · **2 推翻**（修订后） |

> **📌 2026-09-20 修订说明（部署证据补充）**：应审阅要求核对了实际部署参考 `IthacaServer`（`apps/course-scheduling/{docker-compose.yml,app.env}` + `infrastructure/traefik/dynamic/middlewares.yml` + `templates/ops/ops.sh`）。据此修订：
> - **B2** 由 blocker **降级**（`ops rollback`/`ops backup`/`ops restore` + freshness cron 均存在）→ cap-at-69 解除，总分 **67→74**，残留转 H13。
> - **H2** medium→**low**（HSTS 1y+preload / `X-Content-Type-Options:nosniff` / `X-Frame-Options:SAMEORIGIN` / Referrer-Policy / Permissions-Policy 已由 Traefik `secure-headers@file` 在边缘设置，**仅缺 CSP**）。
> - **4.7「0.0.0.0 网络暴露」**、**4.7「滚动部署 schema skew」** 两条 low **推翻**（服务器 compose 删除 app `3000`/DB 主机端口、单实例 `compose up -d` recreate 部署）。
> - **限流类发现**补注：平台已提供 `rate-limit@file`(100/min) 与 `rate-limit-strict@file`(10/min)，仅未挂到 course-scheduling 路由（当前仅 `secure-headers@file,compress@file`）。
> - **H3** 收敛为**加拿大/安省 PIPEDA** 口径（域名属安省组织；MiniMax 中国大陆端点为尖锐点）。

---

## 1. 评分依据（2026-09-20 修订：67 → 74）

- **cap-at-69 原触发已解除**：初判「高影响发布无回滚路径」。核对 IthacaServer 后确认回滚/恢复工具链存在——`ops rollback`（git SHA 代码回滚，deploy 前 `save_rollback_state` 存 `.rollback-ref`）、`ops backup`（`pg_dump` + `data/` → tar.gz）、`ops restore <file>`（psql 还原）、`scripts/check-backup-freshness.sh` cron 告警（源于一次真实备份静默失败事故）。故该硬顶不再适用，落入 **Launchable with Caveats（70-84）** 区间。
- **cap-at-84 不适用**：CI 覆盖上线关键路径（构建生产镜像 → 迁移 → vitest 租户隔离套件 → health smoke → 全量 Playwright E2E 覆盖登录/仪表盘/门户/分享链接）；无证据表明 CI 当前为红。
- **落在 74 而非更高**：仍有 1 条确认 HIGH（B1 升级期 crash-loop）+ 安省未成年人 PII 跨境流向中国区 LLM（H3，PIPEDA）+ 健康检查不探 DB（H1）+ LLM 无超时（H4）+ B2 残留（schema 级回滚纪律，H13）。

未触发的其它 cap 条件（强项）：认证/授权在敏感数据上**齐备**；支付 webhook 幂等性 N/A；密钥**未**泄漏到客户端包/日志/提交文件。

> **情境修正（利好本次首发）**：本次是 course-scheduling 首次纳管 IthacaServer（`prod/ithaca` 分支、全新 `pgdata` 命名卷），迁移 0016 在零行库上干净应用——**B1 不会在此次首发触发**，但必须在下一次「存量库升级」前修复。

---

## 2. Blockers（部署前必修）

### B1 · 迁移 0016 在存在孤儿 tenant_id 的库上 crash-loop 容器 — ✅ 对抗性确认（HIGH）

- **位置**：`docker/entrypoint.sh:4`、`drizzle/0016_tenant_id_fk.sql:8`
- **链条**：`entrypoint.sh:2` 设 `set -e` → `:4` 跑 `node /app/dist/migrate.mjs` → 0016 一次性 `ADD CONSTRAINT ... FOREIGN KEY (tenant_id) REFERENCES public.organization(id) ON DELETE restrict`（18 张表，**无 `NOT VALID`**）→ 任一行 `tenant_id` 无对应 organization → Postgres 报 **23503** → `migrate.ts` `process.exit(1)` → `set -e` 中止 entrypoint（在 `exec node /app/server.js` 之前）→ **容器永久 crash-loop，永不 serve**。
- **孤儿行为何真实可达**：0016 之前 `tenant_id` 上无 FK（正是该迁移存在的原因）；Better Auth org 插件的删除路径（`src/auth/auth.ts:75` 加载时未禁用 `/api/auth/organization/delete`）不会级联到应用表。任何曾丢过一个组织、或被直接操作过的库都会带孤儿行。
- **补救脚本未接线**：`scripts/cleanup-orphan-tenants.ts` 是独立 `npx tsx` 工具，**未**被 entrypoint 调用；恢复依赖运维部落知识。与已知的 `ADMIN_PASSWORD<16` crash-loop 同一类静默部署炸弹。
- **验证结论（CONFIRMED / severity=high）**：每个机械环节均真实、无任何缓解守卫；搜遍 `src/` 无组织删除自动清理路径、无 boot 时守卫。定为 HIGH 而非 critical，仅因它只在「已积累孤儿行的存量库升级」时触发（全新装零行、干净应用）；一旦触发即全量、不自愈的宕机。
- **修复**：在 entrypoint migrate **之前**自动跑 `cleanup-orphan-tenants.ts`（幂等、共用同一 advisory lock），或把 0016 改为 `NOT VALID` 加约束 + 后续单独 `VALIDATE`。

### ~~B2 · 无回滚 / 恢复 / 事故手册~~ — 已降级（评分硬顶解除，残留转 High-value **H13**）

> **2026-09-20 修订**：初判为 blocker，核对部署参考 `IthacaServer` 后**推翻**。回滚/恢复工具链**确实存在**：
> - `ops rollback` — `templates/ops/ops.sh:cmd_rollback`：deploy 前 `save_rollback_state` 把当前 git SHA 存入 `.rollback-ref`，回滚时 `git reset --hard <prev_sha>` + `compose build` + `up -d`。
> - `ops backup` / `ops restore <file>` — `pg_dump`(容器内 unix socket，无需密码) + `data/` 打包为 `backups/<app>_<ts>.tar.gz`；`ops restore` 用 `psql` 还原。
> - `scripts/check-backup-freshness.sh` — cron 扫描 dump 新鲜度并告警（源于 2026-08-20 clossette 备份静默失败事故）。
>
> **残留真实缺口（转 H13，medium）**：`ops rollback` 只回滚**代码**，**不回滚 DB schema**；Drizzle 迁移仅向前，故一次坏/破坏性迁移后 `ops rollback` 会让**旧代码跑在已迁移的新 schema** 上（正是 schema/code skew）；`ops restore` 只能还原到上次 dump（丢失其后数据），非干净 schema 回退。缺 expand/contract 迁移纪律；且 course-scheduling 的 `ops backup` 是否已 cron 化并纳入 freshness 监控**未核实**。
> **修复**：对迁移强制 expand/contract 向后兼容纪律（新迁移必须兼容上一版本代码，使 `ops rollback` 的纯代码回滚安全）；确认本 app 的 `ops backup` 已定时 + 纳入 `check-backup-freshness.sh`；写一页「坏迁移应急」步骤（何时用 `ops rollback` vs `ops restore`）。

---

## 3. High-value fixes（提分 / 降险；以 medium 为主，未做独立对抗验证但带 verbatim 证据）

| # | 维度 | 严重度 | 问题 | 位置 |
|---|---|---|---|---|
| H1 | 运维/可观测 | medium | 健康检查是静态 `{ok:true}`，**不探 DB**——DB 挂了编排仍显示绿，Traefik 继续打流量，容器永不重启/自愈 | `src/app/api/health/route.ts:4` |
| H2 | Web 加固 | ~~medium~~ **low** | **多数已在边缘缓解**（Traefik `secure-headers@file`）：HSTS(1y+preload)、`X-Content-Type-Options:nosniff`、`X-Frame-Options:SAMEORIGIN`（点击劫持已挡）、Referrer-Policy、Permissions-Policy 均已设。**仅缺 Content-Security-Policy**；因叙述纯文本渲染无 XSS sink，属纵深防御 | `infrastructure/traefik/dynamic/middlewares.yml`（IthacaServer） |
| H3 | 隐私合规（**安省 PIPEDA**） | medium | 安省未成年人真名+年级+评语+shared 笔记**无同意闸门、无脱敏**跨境流向 LLM。`REPORT_PROVIDER` 默认 anthropic（美国，已属跨境）；app.env 注释与 `.env.extra` 走 **MiniMax `api.minimaxi.com`（中国大陆）**——把安省儿童教育记录传入无充分性认定的司法辖区，是本项目最尖锐的 PIPEDA 合规暴露 | `src/lib/report-data.ts:99`；`apps/course-scheduling/app.env` |
| H4 | 可用性/DoS | medium | LLM 调用**无 timeout / AbortController / maxRetries 覆盖**，SDK 默认 ~10min × 3 次重试；同步跑在 server action 里，几个并发起草即可耗尽请求并发、拖垮整站 | `src/lib/report-draft.ts:39,64` |
| H5 | 纵深防御 | medium | **无 Postgres RLS 兜底**，多租户全靠「每处都记得 `forTenant()`」；一个未来的 raw `db.select().from(tenantTable)` 即静默跨租户读写。ADR 0001 自述的 revisit 触发器「真实客户数据落地」已到 | `src/db/tenant.ts:22` |
| H6 | 访问控制 | medium | 分享/日历 token **永不过期**（`shareLink`/`sectionShareLink`/`calendarFeed` 均无 `expiresAt`，仅 `isNull(revokedAt)`）；经微信/二维码转发即永久暴露孩子姓名/课表/地点；whole-tenant 日历 feed 令牌泄漏暴露全机构课表 | `src/db/schema/share-link.ts:16` |
| H7 | 事务边界 | medium | 改期审批 claim→move→notify **非原子**：claim 提交后崩溃 / `releaseClaim()` 抛错 → 请求卡在 `approved` 但课未移，且所有复核路径守 `status='pending'`，**永远无法恢复** | `src/lib/reschedule-core.ts:145` |
| H8 | 数据生命周期 | medium | 0016 的 18 条 RESTRICT FK 后，**删除有数据的组织不可能**，且无 purge 例程（grep `deleteOrganization/purgeTenant` 无实现）；合法的租户下线/擦除需手写有序 SQL | `drizzle/0016_tenant_id_fk.sql:6` |
| H9 | 前端恢复 | medium | 越权 staff 直达无权页 → `requirePermission` 抛 `AuthError('FORBIDDEN')` → 落到通用 `dashboard/error.tsx`，「重试」按钮 `reset()` 立即再抛 = **死循环**，且被误导为瞬时错误 | `src/app/dashboard/schedule/page.tsx:9`、`src/auth/authorize.ts:16` |
| H10 | 前端恢复 | medium | portal 与 (auth) 段**无 error.tsx**（仅 dashboard 有）；一次 DB 抖动 → 冒泡到 `global-error.tsx` 替换整个文档，门户用户（最不技术的家长/学生）丢失整个应用外壳 | `src/app/portal/layout.tsx:24` |
| H11 | 暴力破解 | medium | 登录 `/sign-in/email` 仅靠 better-auth 默认内存限流；**无按账号锁定**，配合 8 位口令下限使在线爆破可行。**缓解**：把 Traefik `rate-limit-strict@file`(10/min) 挂到路由（当前仅挂 `secure-headers/compress`）即得边缘限流；单实例部署下内存限流可接受 | `src/auth/auth.ts:11` |
| H12 | 凭据爆破半径 | medium | MCP 静态 bearer 映射到固定 owner 级主体（读+写全租户），**无过期、无轮换机制、无 per-tool scope**；一次泄漏 = 该租户全量读写 + 批量 PII 外泄（`list_students` 返回每个学生 `parentWechat`） | `src/auth/mcp-context.ts:29`、`src/mcp/register-tools.ts:140` |
| H13 | 部署/迁移 | medium | （由 B2 降级）`ops rollback` 只回滚**代码**不回滚 DB schema，坏迁移后旧代码跑新 schema；`ops restore` 丢失上次 dump 后数据；缺 expand/contract 纪律；本 app `ops backup` 是否已定时/纳入 freshness 监控未核实 | `templates/ops/ops.sh:cmd_rollback`（IthacaServer） |

**建议优先级**：先做 **B1**（接线 `cleanup-orphan-tenants.ts`，防下次升级 crash-loop）+ **H1**（健康检查探 DB）+ **H3**（起草前对 MiniMax/跨境加同意闸门 + 姓名脱敏）+ **H4**（LLM 超时）——一次 draft PR，均低风险高收益。**H2** 仅需在 Traefik middleware 补一条 CSP；**H11/H12/限流类**只需把已存在的 `rate-limit(-strict)@file` 挂到相应路由。H5（RLS 兜底）作为后续里程碑（先落 CI grep 守卫）。

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
| low ▫ | MCP/cron 鉴权端点无应用层限流（残余风险为请求洪泛 DoS，非凭据恢复）；可挂 Traefik `rate-limit(-strict)@file` 到 `/api/mcp`、`/api/cron/*` 缓解 | `src/app/api/[transport]/route.ts:19` |

### 4.5 AI 报告起草（ai-report-surface）— 4 条
| 严重度 | 标题 | 位置 |
|---|---|---|
| medium ▫ | 安省未成年人 PII 无同意/脱敏跨境发往 LLM（默认 Anthropic-US；MiniMax-CN 为尖锐点）——安省 PIPEDA（见 H3） | `src/lib/report-data.ts:99` |
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
| medium ▫ | 健康检查静态 `{ok:true}`，不验证 DB 可达（见 H1；注：compose healthcheck 也仅打此端点，DB 挂时容器仍报 healthy） | `src/app/api/health/route.ts:4` |
| medium ▫ | 回滚仅代码不含 schema + 无 expand/contract 纪律（**B2 已降级为 H13**；`ops rollback/backup/restore` 存在，见 §2） | `templates/ops/ops.sh`（IthacaServer） |
| ~~low~~ **已推翻** | ~~滚动部署 schema skew~~ — IthacaServer `ops deploy` 是单实例 `compose up -d` recreate（非滚动），无新旧容器并存窗口 | `templates/ops/ops.sh:cmd_deploy`（IthacaServer） |
| ~~low~~ **已推翻** | ~~app 在 `0.0.0.0` 暴露 3000~~ — 服务器 compose 删除了 app `3000:3000` 与 db 主机端口，仅经 Traefik 反代 + 内网；仅本地 compose 有该绑定 | `apps/course-scheduling/docker-compose.yml`（IthacaServer） |

### 4.8 输入校验 / Web 加固（input-validation）— 5 条
| 严重度 | 标题 | 位置 |
|---|---|---|
| ~~medium~~ **low** ▫ | 边缘已设 HSTS/nosniff/`X-Frame-Options:SAMEORIGIN`/Referrer/Permissions（Traefik `secure-headers@file`），**仅缺 CSP**（见 H2） | `infrastructure/traefik/dynamic/middlewares.yml`（IthacaServer） |
| low ▫ | 重型 Chromium PNG/ZIP 导出路由无应用层限流（单 mutex 后队列无界）；可挂 Traefik `rate-limit-strict@file` 到导出路径缓解 | `src/app/api/export/student/[studentId]/png/route.ts:22` |
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
- **部署层加固（IthacaServer，2026-09-20 补充）**：Traefik 统一 TLS（Let's Encrypt）+ 边缘安全头中间件（HSTS 1y+preload / nosniff / X-Frame-Options:SAMEORIGIN / Referrer / Permissions-Policy）；服务器 compose 删除 app/DB 主机端口，仅内网 + 反代；per-app Linux 用户隔离 + scoped sudoers/SSH；`ops` 工具链提供 `deploy`（recreate）/`rollback`（代码）/`backup`（pg_dump+data）/`restore`；备份新鲜度 cron 监控；命名卷 `pgdata` 落在 app 目录外免疫 chown。

---

## 6. 审计元信息

**Evidence checked**：`git status`/`git log`；`package.json`；`src/env.ts`、`.github/workflows/ci.yml`、`src/app/api/health/route.ts`；全量 `src/auth/*`、`src/db/tenant.ts`+schema、`src/lib/*-core.ts` 及 `share/ical-feed/report-*/reschedule/materialize/conflict/rate-limit/browser/push-*/errors`、公开 token 路由（`/s`、`/sec`、`/api/calendar`）、`api/[transport]`+`mcp/register-tools`、`api/cron/reminders`、`api/export/**`、`api/reports/**`、`drizzle/0001-0017` + `scripts/migrate.ts`+`cleanup-orphan-tenants.ts`、`docker/entrypoint.sh`、`Dockerfile`、`docker-compose.yml`、`dev.sh`、`next.config.ts`、`docs/adr/0001-0002`、前端布局/error/loading 边界与登录/门户页面。（9 维度并行审阅 + 对 HIGH 独立对抗验证；共 200 次工具调用。）
**部署证据（2026-09-20 补充）**：`IthacaServer/apps/course-scheduling/{docker-compose.yml,app.env}`、`infrastructure/traefik/dynamic/middlewares.yml`、`templates/ops/ops.sh`（deploy/rollback/backup/restore 函数体）、`scripts/check-backup-freshness.sh`、`docs/migration-runbook.md`、`README.md`。

**Evidence missing（补上会改变置信度）**：
1. main 当前 CI 是否为绿（未实跑 pipeline）。
2. course-scheduling 的 `ops backup` 是否已 cron 化并纳入 `check-backup-freshness.sh` 监控（决定 B2 残留/H13 的实际备份覆盖；且本 app compose 未挂 postgres-backup sidecar，dump 全靠 `ops backup`）。
3. 组织入驻/家长同意是否已覆盖「个资跨境传输给 LLM（含中国区 MiniMax）」（决定 H3 是否可闭合；安省 PIPEDA 口径）。
4. 未实际驱动运行中的应用观察行为（本次为纯静态 + 结构 + 部署配置审计）。
5. 12 条 medium 未做独立对抗验证（均带 verbatim 证据 + file:line，可信但未二次核实）。

**Next action**：先修 **B1** —— 把 `scripts/cleanup-orphan-tenants.ts` 接进 `docker/entrypoint.sh` migrate 之前（一行改动、幂等、共用 advisory lock、零风险），消除下次升级期 crash-loop。可与 **H1**（健康检查探 DB 返 503）+ **H3**（起草前对跨境/MiniMax 加同意闸门 + 姓名脱敏，安省 PIPEDA）+ **H4**（LLM `timeout`/AbortController）打包为一个 app 侧 draft PR；**H2** 只需在 IthacaServer 的 `middlewares.yml` 补一条 CSP，**限流类**只需把已存在的 `rate-limit(-strict)@file` 挂到相应路由（属部署仓改动，不在本 app repo）。

---

*审计方法：9 风险维度并行静态审阅（Opus 4.8）→ 对每条 critical/high 发现做对抗性验证（要求验证者尽力 REFUTE，默认怀疑）。本报告为工程分诊，非法律/合规认证。*
