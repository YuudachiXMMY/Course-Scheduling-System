# 课程排期与规划系统 (Course Scheduling & Planning System)

## Problem Statement

一位独立教师（家教）当前用 **Google Calendar 手动建课** + **微信逐个和家长确认/改期**来管理每个学生、每门课程的安排。随着学生数增长和家长沟通变复杂，**排课冲突**和**反复确认/通知的沟通成本**成为最耗时、最易出错的环节。不解决的代价是：时间被琐碎沟通吞噬、偶发排课冲突损害专业形象，且这套手动流程无法随着学生/助教规模扩大而扩展。

## Evidence

- **用户直述（现状）**："目前是手动用 Google Calendar 建立，并微信和家长确认/更改时间。"
- **用户直述（痛点）**："需要手动和家长/学生确认时间"；"家长沟通变复杂"。
- **用户直述（成功定义）**："省下沟通成本，避免排课冲突，或减少确认时间/通知。"
- **规模信号**：当前 4 个学生、约 5 门课程，小班常见 1-3 人、最多 10-15 人；12 个月内预计约 **5 门课程、共 15-30 名学生**，且会持续增长——手动流程的边际成本随规模线性上升，而此规模仍远低于需要 Redis/队列或 Google OAuth 验证（100 用户上限）的门槛。
- ⚠️ 以上均为单一用户（产品所有者本人）的第一手陈述，未做外部市场验证（用户明确要求跳过竞品调研，因为是个人自用）。核心假设的量化目标需在上线后用真实使用数据验证。

## Proposed Solution

构建一个**以自有数据库为唯一真相源 (source of truth)** 的全栈 Web 应用：教师在系统内录入学生/课程/排期，系统**自动检测时间冲突**；排好的课表通过**只读 .ics/webcal 订阅源**单向推送到教师自己的 Apple/Google 日历（零凭证、零 OAuth）；面向家长则通过**一键导出（微信友好的 PNG 图片 + 只读分享链接 + .ics）** 消除反复确认的沟通成本；后续支持**每个学生/课程的 AI 起草、教师审核的 PDF 报告**、**Claude MCP connector**（对话式排课/起草家长消息），并最终扩展为**多角色（助教/管理员/家长/学生登录）** 的小型团队产品。

选择这一路径而非"双向实时同步优先"或"Vercel 零运维默认"，是因为：(1) 单向发布彻底规避了双向同步的冲突解决/时钟漂移复杂度，用最小成本解决核心痛点；(2) 目标受众用微信、内容为中文，自建香港 VPS（Coolify 管理）在微信链接可打开性、中文字体渲染、国内网络访问上显著优于 Vercel，同时 Coolify 提供接近 Vercel 的部署体验，契合"能跑就好、少运维、但我会自维护服务器"的定位。

## Key Hypothesis

我们相信，**"系统内排课 + 自动冲突检测 + 一键导出课表给家长"** 会为**独立教师****大幅降低家长沟通/确认成本并消除排课冲突**。
当满足以下条件时我们就知道方向对了：**排课冲突导致的改期降为 0，每次"排好课→家长知晓"的往返沟通从多条微信降到一次发送（< 30 秒），且这套流程在学生数增长时不增加人均管理时间。**

## What We're NOT Building

- **双向实时日历同步（MVP 阶段）** — 冲突解决/时钟漂移/Google watch 通道 7 天过期/iCloud 无 push，成本远高于收益；MVP 用单向发布替代，双向按 provider 逐个延后。
- **原生 iOS/Android App** — 用响应式可安装 PWA 覆盖"手机随时看/操作"，避免应用商店与双端维护成本（如后期需要推送再用 Capacitor 壳）。
- **学费/付款/账单系统（MVP 阶段）** — 数据模型预留扩展位，功能延后到后续阶段。
- **家长/学生登录门户（MVP 阶段）** — MVP 家长通过导出/只读分享链接获取课表，无需账号；登录门户（含家长自助改期申请）放到多角色阶段。
- **自动课程提醒（MVP 阶段）** — 用户确认 MVP 先不做提醒；延后到多角色阶段再评估渠道（邮件/短信/微信）。
- **Google 双向同步（MVP 阶段，且长期 optional）** — 教师本人主要用 Apple 日历，只读订阅已永久够用；Google 双向 + 邀请受邀人（用户 OAuth）仅作后续可选增强。
- **通用 SaaS/多机构商业化** — 先服务本人及未来小团队，不做面向陌生机构的注册开放、计费、市场投放。
- **市场/竞品调研** — 用户明确要求跳过（个人自用）。

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| 排课冲突导致的改期次数 | 0 / 月 | 系统冲突检测拦截日志 + 教师手记 |
| "排好课 → 家长知晓" 的沟通往返 | 从多条微信降到 1 次发送 | 教师主观计数（上线前后各记 2 周） |
| 单次导出并发送课表耗时 | < 30 秒 | 应用内导出操作埋点计时 |
| 单份课程报告生成耗时 | 手写基线的 ≤ 30% | 报告"开始起草→定稿"埋点计时 |
| 教师每周花在排课/沟通上的时间 | 随学生数增长而**不上升** | 教师每周自报（上线后 8 周趋势） |
| 每周活跃使用（教师本人） | ≥ 5 天/周 | 登录/操作埋点 |

> 所有目标为**假设性基线**，需上线后用真实数据校准；当前无历史埋点数据。

## Open Questions

**已解决（见 Decisions Log）**：Google 双向定为 optional/后续（MVP 只订阅）；MVP 不做提醒；家长/学生需写权限（自助改期→审批）；数据处理在服务条款/家长告知中声明；教师主用 Apple 日历（只读订阅永久够用）；规模约 5 课程 / 15-30 学生；测试与部署用 Docker 容器。

**仍待明确（不阻塞 MVP）**：

- [ ] 后续提醒渠道具体选型：微信（需公众号/企业微信）/ 短信（需中国网关 + 预算）/ 邮件？——延后到多角色阶段。
- [ ] 家长自助"申请改期"的确切交互与规则：可改期窗口、需提前多久、冲突时的备选时段建议、审批 SLA。
- [ ] 服务条款/家长告知的具体文案与呈现位置（分享页页脚 / 门户注册同意）。
- [ ] 是否需要 iCloud CalDAV 写入（仅当教师想在 Apple 内直接编辑课程时才需要）。

---

## Users & Context

**Primary User — 独立教师 / 家教（产品所有者本人）**
- **Who**: 独立授课的老师，同时管理多个学生的一对一及小班（1-3 人常见，最多 10-15 人）课程；具备一定技术能力，愿意自维护代码与服务器。
- **Current behavior**: 手动在 Google Calendar 建课，用微信逐个与家长确认时间/改期，口头或手动整理后发课表；报告靠手写。
- **Trigger**: 每当需要新排/改一节课，或家长问"这周几点上课"、"下个月安排"时，就要重复一轮手动确认+通知。
- **Success state**: 在系统里排一次课，冲突被自动挡住；一键把某学生/某小班的课表导成微信可发的图片/链接发出去；月末一键生成每个学生的报告。手机上随时能看和改。

**Job to Be Done**
> 当我需要为某个学生/小班安排或调整课程、并让家长清楚知道上课时间时，我想要在一个系统里排课（自动避开冲突）并一键把课表发给家长，这样我就能省下反复微信确认的时间、避免排错时间，并且在学生变多时依然从容。

**Secondary / Future Users**
- 助教、其他老师、机构管理员（多角色协作，后续阶段）。
- 家长 / 学生（后续阶段登录查看自己的课表与报告，并可**自助申请改期（写权限）**，由教师审批）。

**Non-Users（明确不服务）**
- 面向陌生机构开放注册的通用 SaaS 客户——不做商业化获客。
- 需要复杂教务/财务/CRM 全家桶的大型培训机构——本系统聚焦排期、通知、报告。
- 需要在 MVP 就用账号登录的家长/学生——MVP 用无登录的导出/分享链接覆盖。

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | 学生 / 课程 / 排期（含重复课 RRULE）的录入与管理 | 一切功能的地基；用户选定的 MVP 核心 |
| Must | **自动排课冲突检测** | 直接命中"避免排课冲突"痛点；用户选定的 MVP 核心 |
| Must | 响应式 UI（桌面 + 手机可看/可操作，PWA 可安装） | 用户明确"手机需随时看/操作" |
| Must | 一键导出课表（微信友好 PNG + 只读分享链接 + .ics），支持小班批量、按学生/家长切分 | 直接命中"省沟通成本、减少确认/通知"核心痛点 |
| Must | 出勤 / 课堂笔记记录 | 报告与进度追踪的数据来源 |
| Should | 只读 .ics/webcal 订阅源，单向推送到教师自己的 Apple + Google 日历 | 替代当前"手动建 Google Calendar"，零凭证低风险 |
| Should | 每学生/课程 PDF 进度报告（Claude 起草 + 教师审核定稿，小班批量） | 用户明确需要"生成 report" |
| Should | Claude MCP connector（对话式排课、起草家长消息） | 用户明确希望"接 Claude 的 MCP 或 connector" |
| Could | 家长/学生自助**申请改期（写权限）** + 教师审批 | 用户确认家长/学生需写权限；随登录门户落地，走"申请→审批"流 |
| Could | 多角色（助教/管理员/家长/学生登录）与权限 | 未来团队协作与家长自助查看/申请 |
| Could | Google 双向同步 + 邀请家长/学生为受邀人（用户 OAuth，**optional**） | 教师主用 Apple、订阅已够用；双向为后续可选增强 |
| Could | 学费/课时包/付款状态追踪 | 数据模型预留，后续按需 |
| Could | 自动课程提醒（邮件 / 短信 / 微信渠道；**MVP 不做**） | 用户确认 MVP 先不做，渠道待定 |
| Won't (now) | iCloud CalDAV 双向写入 | 教师主用 Apple，但**只读订阅已满足其查看需求**；无官方 API、凭证风险高，仅在确需在 Apple 内直接编辑时才建 |
| Won't (now) | 原生 App、付款收单、面向机构的多租户商业化 | 超出个人自用 MVP 范围 |

### MVP Scope（验证假设的最小闭环）

**MVP = Phase 1 → 4**，其中 **Phase 2（排课 + 冲突检测）为用户选定的核心地基**：

1. 可部署、带鉴权、多租户就绪的骨架（Next.js + Postgres + Drizzle + Better Auth，Coolify/HK VPS）。
2. 教师端排课：学生/课程/课节 CRUD、重复课、响应式日历视图、**自动冲突检测**、出勤/笔记。
3. 只读 .ics/webcal 订阅源（Apple + Google 均可订阅）+ 可安装 PWA。
4. 家长导出/分享：微信 PNG（含指向只读页的二维码）+ 只读 token 分享页 + .ics 附件；小班批量 ZIP，每位家长只拿到自己孩子的课节。

这一闭环即可验证核心假设（冲突归零 + 沟通一键化）。报告、MCP、双向同步、多角色为紧随其后的增强。

### User Flow（最短达成价值路径）

```
教师登录 → 新建/选择学生与课程 → 拖拽/表单排一节课
  → 系统实时校验时间冲突（冲突则拦截并提示可用时段）
  → 保存（课表出现在教师订阅的 Apple/Google 日历中）
  → 点“导出/分享” → 选该学生或该小班 → 生成微信 PNG + 只读链接
  → 复制发到微信/邮件给家长（< 30 秒，无需再逐条确认）
```

---

## Technical Approach

**Feasibility**: **HIGH** — 六个维度（Apple 日历、Google 日历、MCP、导出分享、报告、技术栈）均有成熟的 2026 库与成熟路径；唯一真正困难的是双向日历同步，方案已在 MVP 中刻意规避。

**推荐技术栈（低运维、单盒、中文/微信友好）**

| 层 | 选择 | 理由 |
|----|------|------|
| 前端 + 移动 | Next.js 16 App Router (React 19)，响应式可安装 **PWA** | 一套代码覆盖桌面+手机；免应用商店。接受 iOS PWA 限制（推送需 16.4+、需手动添加到主屏、无后台同步），提醒用邮件/短信兜底 |
| 后端 / API | Next.js Route Handlers + Server Actions | 无独立 API 服务；MCP、.ics 源、PDF/PNG 生成、cron 目标都作为同一 app 的路由。鉴权在 handler/数据层强制，**不可只靠 middleware**（CVE-2025-29927 类漏洞） |
| 数据库 | 单 VPS 上 **PostgreSQL**（Coolify 一键 + S3 自动备份） | 单盒单账单、国内延迟最低、数据可移植。Supabase/Neon 为托管备选 |
| ORM | **Drizzle ORM** | SQL-first、无 codegen（solo 部署更简单）、与 Better Auth 一等集成。Prisma 7 为备选 |
| 鉴权 + RBAC | **Better Auth**（Organization + Admin/RBAC 插件） | 用户表就在自有 Postgres、无按 MAU 计费；org/role 插件当天即支持 owner/teacher/assistant/admin/parent/student 与轻量多租户 |
| 托管 | **单台香港 VPS + Coolify + Docker** | HK 免 ICP 备案、离微信近；Coolify 提供 push-to-deploy、自动 SSL、Postgres 备份；MCP connector 需公网 HTTPS（Claude 从 Anthropic 云端调用） |
| 后台任务 | 在盒 cron（Coolify 定时任务 / node-cron worker） | Google syncToken 轮询、课程提醒、后续 CalDAV 轮询与 Google watch 通道续期（≤7 天过期）。量大再上 BullMQ+Redis |
| MCP | **mcp-handler**（MCP TS SDK，无状态 Streamable HTTP，`app/api/[transport]/route.ts`） | 作为 Next.js 路由挂载、无需 Redis（SSE 已弃用）。领域建模为 **tools**；MVP 静态 bearer token，后续 OAuth 2.1（WorkOS AuthKit） |
| PDF / ICS / PNG | 报告 **@react-pdf/renderer**（免 Chromium）；微信卡片 **Playwright**（装 CJK 字体）；**ical-generator** 生成 .ics/webcal | @react-pdf 服务端 <500ms 出 PDF（内嵌 Noto Sans SC .ttf）；Playwright 可靠渲染中文（Satori/@vercel/og 会静默出豆腐块） |

**Architecture Notes**
- **唯一真相源永远是自有 Postgres**。日历集成"向外发布优先"，不把任何外部日历当权威——MVP 彻底移除冲突解决。
- **多租户与 RBAC 第一天就设计**（事后补授权成本极高）：每张表带 `tenant_id`；选课建模为**多对多**（student ↔ session）；行级授权在数据层依据**已验证的 principal** 强制，绝不信任作为参数传入的 ID，绝不只靠 middleware。
- **中文渲染是全链路（Web/PNG/PDF/ICS）第一天的一等公民**：@react-pdf 用本地 `.ttf` `Font.register`（不用 Google Fonts URL）；VPS 上 `apt install fonts-noto-cjk` + `fc-cache`，Playwright 截图/打印前 `await document.fonts.ready`。缺字形会静默变豆腐块，须早验证。
- **LLM 安全**：报告里数字类事实（出勤率、成绩）直接从 DB 渲染，Claude 只写叙述性文字（"不得编造事实"），并有**教师审核/定稿（draft vs approved）门禁**。MCP 的写/外发工具（排课、删除、发家长消息）一律 **draft-and-confirm**，绝不 fire-and-forget。
- **.ics 稳定性**：每个 VEVENT 的 UID 由 DB 主键确定性派生（导入端去重/原地更新，避免每次刷新重复）；显式 `TZID=Asia/Shanghai`。
- **秘钥**：Google refresh token / 任何 Apple 专用密码加密存储、最小权限、用户可撤销、绝不记日志；优先走无凭证路径。
- **容器化（测试=生产一致）**：多阶段 Dockerfile（非 root 运行、alpine/distroless、固定版本标签）+ docker-compose（app + Postgres）用于本地开发与测试；生产由 Coolify 编排**同一镜像**。CI 在容器内跑迁移与测试，保证环境一致、可移植、少运维。
- **合规透明（PIPL/未成年人）**：在服务条款/家长告知中声明数据处理方式（含课程报告经 Claude API 起草）；家长/学生首次访问分享页或登录门户时可见告知。
- **家长/学生写权限（自助改期）**：不是直接编辑日历，而是"申请改期 → 教师审批 → 系统更新并重发课表"的工作流；改期申请是受严格 RBAC 约束的写操作，全程审计留痕。

**Technical Risks**

| Risk | Likelihood | Impact | Mitigation |
|------|:---:|:---:|------------|
| 中文在 PDF/PNG 里渲染成豆腐块 | H | H | 本地 Noto Sans SC `.ttf` + `Font.register`；VPS 装 fonts-noto-cjk + fc-cache；`document.fonts.ready`；上线前用真实中文名逐面验证 |
| 双向同步漂移/静默丢改（Google 通道 ≤7 天过期、iCloud 无 push、仅整体 PUT） | M | H | MVP 保持单向、Postgres 为真相源、只读 .ics；Google 双向仅加通道续期 cron + 410 fullSyncRequired 处理；iCloud 仅 app→cloud 不回读 |
| 多租户/RBAC 隔离失败（越权读改他人学生；**家长/学生写权限扩大攻击面**） | M | H | 每表 tenant_id + 多对多选课；行级授权在数据层按已验证 principal（非 middleware-only，CVE-2025-29927）；家长/学生"改期申请"限定为受约束写操作 + 教师审批，**不给直接编辑**；不单凭传入 ID |
| Prompt 注入 / MCP 自主写操作误动真实数据 | M | H | 所有工具调用保留 human-in-the-loop；删除/外发类 draft-and-confirm；token 窄权限；服务端校验；写操作审计日志 |
| LLM 把出勤/成绩/进度事实幻觉进报告 | M | H | 数字从 DB 直渲；prompt 只允许总结所给结构化数据；强制教师审核门禁 |
| 存储的 Apple 专用密码 / Google refresh token 泄露 | M | H | 优先无凭证路径；必须存时 KMS/列加密、最小权限、可撤销、401 触发重认证、绝不记日志 |
| 微信拦截分享链接（"无法验证安全性"）、且打不开 .ics | H | M | 以 PNG 图片为主（无需域名信任）并叠加指向只读页的二维码；链接放 HK/备案域名、无重定向/短链；.ics 仅作邮件/iPhone 次要渠道 |
| Google 双向 + 邀请受邀人须用户 OAuth（敏感权限、人工审核、100 用户上限） | L | M | **已定为 optional/后续**，MVP 不涉及；届时用用户 OAuth、发布状态设 Production（免 7 天失效）、尽早启动验证。当前 15-30 学生远低于上限 |
| OAuth 停留在 Testing 导致 refresh token 7 天失效 / 验证延迟阻塞放量 | M | M | 发布状态设为 Production（即使未验证也移除 7 天过期）；尽早启动验证 |
| Playwright 无头 Chromium 占资源、拖垮小 VPS | M | M | 报告用 @react-pdf（无浏览器）；PNG 卡片用单个常驻 Playwright + 并发限流；`--no-sandbox --disable-dev-shm-usage`；瓶颈时移交 Gotenberg |
| solo 运维负担 / 单 VPS 正常运行时间/备份缺口 | M | M | Coolify push-to-deploy + 自动 SSL + 一键 Postgres 备份到 S3；文档化并演练恢复；预算约 4-8h 初装 + 10-20h/年维护 |

---

## Implementation Phases

<!--
  STATUS: pending | in-progress | complete
  PARALLEL: phases that can run concurrently (e.g., "with 3" or "-")
  DEPENDS: phases that must complete first (e.g., "1, 2" or "-")
  PRP: link to generated plan file once created
-->

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
|---|-------|-------------|--------|----------|---------|----------|
| 1 | Foundation & Deploy | 可部署、鉴权、多租户就绪的骨架（Next.js + Postgres + Drizzle + Better Auth + 核心 schema + Coolify/HK VPS） | complete | - | - | [plan](../plans/completed/phase-1-foundation-deploy.plan.md) · [report](../reports/phase-1-foundation-deploy-report.md) |
| 2 | Core Scheduling + Conflict（MVP 核心） | 学生/课程/课节 CRUD、重复课、响应式日历、**自动冲突检测**、出勤/笔记 | complete | - | 1 | [plan](../plans/completed/phase-2-core-scheduling-conflict.plan.md) · [report](../reports/phase-2-core-scheduling-conflict-report.md) |
| 3 | Calendar Publish (one-way) + PWA | 只读 .ics/webcal 订阅源（Apple+Google）+ 可安装 PWA | complete | with 4 | 2 | [plan](../plans/completed/phase-3-calendar-publish-pwa.plan.md) · [report](../reports/phase-3-calendar-publish-pwa-report.md) |
| 4 | Parent Sharing & Export（WeChat-first） | 微信 PNG + 只读分享页 + .ics；小班批量、按家长切分 | complete | with 3 | 2 | [plan](../plans/completed/phase-4-parent-sharing-export.plan.md) · [report](../reports/phase-4-parent-sharing-export-report.md) |
| 5 | Progress Reports | @react-pdf PDF + Claude 起草（教师审核门禁）+ 小班批量 | complete | with 6 | 2, 4 | [plan](../plans/completed/phase-5-progress-reports.plan.md) · [report](../reports/phase-5-progress-reports-report.md) |
| 6 | Claude MCP Connector | mcp-handler Streamable HTTP，任务型 tools，静态 bearer，draft-and-confirm | complete | with 5 | 2 | [plan](../plans/completed/phase-6-claude-mcp-connector.plan.md) · [report](../reports/phase-6-claude-mcp-connector-report.md) |
| 7a | Team/Parent/Student Logins + Reschedule Requests | 多角色登录门户（家长/学生）+ 自助改期申请→教师审批工作流 + RBAC 行级硬化 + 数据处理告知/未成年人同意页 | complete | - | 3, 4, 5, 6 | [plan](../plans/completed/phase-7a-portal-reschedule.plan.md) · [report (PR-1)](../reports/phase-7a-portal-reschedule-report.md) · [report (PR-2)](../reports/phase-7a-portal-reschedule-pr2-report.md) |
| 7b | Reminders & Notifications | 自动课程提醒（在盒 cron + 邮件/短信兜底）；改期通过后通知家长；渠道选型 | pending | with 7c | 7a | - |
| 7c | MCP OAuth 2.1 | MCP connector 从静态 bearer 升级到 OAuth 2.1（**Better Auth `mcp` 插件**，`requireMcpAuth` + RFC 9728，校验 token aud；**取代原定 WorkOS AuthKit**——见 plan 内偏差说明与 ADR 0002），支持多用户 | in-progress | with 7b | 6, 7a | [plan](../plans/phase-7c-mcp-oauth.plan.md) |
| 7d | (optional) Google Two-way Sync | Google 双向同步 + 邀请家长/学生为受邀人（用户 OAuth，watch 通道续期 cron，410 fullSync 处理）；仅确需时做 iCloud CalDAV | pending | - | 7a | - |
| 7e | Payments & Credits | 学费/课时包/付款状态追踪落地（数据模型已预留 payment/creditPackage） | pending | - | 7a | - |

### Phase Details

**Phase 1: Foundation & Deploy**
- **Goal**: 在真实基础设施上先跑起一个可部署、带鉴权、多租户就绪的骨架，再做任何功能。
- **Scope**: Next.js 16 + Postgres + Drizzle（Coolify/HK VPS，自动 SSL + 备份）；Better Auth（Organization + Admin/RBAC，owner/teacher/assistant/admin/parent/student）；核心 schema（Course 模板 vs ClassSection/Offering 学期实例、Lesson/Session、Student、多对多 Enrollment、Attendance、Grade、Note，处处 `tenant_id`；预留 payment/课时包与家长改期申请（RescheduleRequest）扩展位）；数据层强制行级授权；**容器化**：多阶段 Dockerfile（非 root 运行）+ docker-compose（app + Postgres）用于本地开发/测试，Coolify 用同一镜像部署，保证测试=生产一致。
- **Success signal**: 能 push 部署、能登录、不同 tenant 数据互不可见；schema 迁移可跑。

**Phase 2: Core Scheduling + Conflict（MVP 核心）**
- **Goal**: 让教师能在桌面和手机上端到端管理自己的课程、学生、课节。
- **Scope**: 班级/课节/学生 CRUD；响应式日历 UI；重复课（RRULE，实例级改/删）；**保存前实时冲突检测**（冲突拦截 + 提示可用时段）；出勤与课堂笔记录入。
- **Success signal**: 排一节与已有课冲突的课会被挡住；重复课能正确展开与单实例编辑；手机上可完成排课。

**Phase 3: Calendar Publish (one-way) + PWA**
- **Goal**: 让教师排的课零凭证地出现在自己手机/桌面日历里，并让 app 可安装。
- **Scope**: 只读 .ics/webcal 源（DB 派生稳定 UID、`TZID=Asia/Shanghai`、不可猜 token、`text/calendar`、无鉴权墙），Apple 与 Google 均可订阅；可安装 PWA（安装提示排在通知权限请求之前）。
- **Success signal**: 在 Apple 与 Google 日历订阅后能看到课表；改课后按订阅刷新周期更新且不重复。

**Phase 4: Parent Sharing & Export（WeChat-first）**
- **Goal**: 让教师能通过微信和邮件可靠地把每位家长孩子的课表发出去。
- **Scope**: 一套样式化 React 课表模板派生三种产物——(1) Playwright 渲染的 PNG（deviceScaleFactor 2、大字号、叠加指向只读页的二维码，**微信主投递物**）；(2) 长随机 token 的只读网页（noindex）；(3) ical-generator 生成的 .ics（邮件/iPhone 附件）。小班批量循环模板 + archiver 打 ZIP，每位家长只含自己孩子的课节；只读分享页页脚含**数据处理告知**链接（PIPL 透明）。
- **Success signal**: 一键为某学生/某小班导出，微信能直接发图；家长点开只读页正常；批量 ZIP 每份仅含对应孩子。

**Phase 5: Progress Reports**
- **Goal**: 生成每学生 PDF 进度报告，叙述由 AI 起草、教师审核。
- **Scope**: ProgressReport 数据 + @react-pdf/renderer（内嵌 Noto Sans SC）；Claude 起草叙述（数字从 DB 渲染、"不得编造事实"、版本化可缓存 rubric）+ draft-vs-approved 教师门禁；小班顺序循环 + ZIP。
- **Success signal**: 一份报告数字准确（与 DB 一致）、中文不豆腐、教师可改可批准、批量可出。

**Phase 6: Claude MCP Connector**
- **Goal**: 让教师能在 Claude 里对话式驱动排课与查参考数据。
- **Scope**: mcp-handler Streamable HTTP 端点，任务型 tools（`list_classes`、`schedule_lesson`、`reschedule_lesson`、`get_lesson_notes`、`list_students`、`draft_parent_message`），静态 bearer token 鉴权，严格 Zod schema，每个 handler 内按已验证 token 做行级授权，所有写/外发工具 draft-and-confirm。
- **Success signal**: 在 Claude Code / Claude.ai 添加 connector 后能列课、能（经确认后）排课、能起草家长消息草稿。

> **Phase 7 拆分说明（2026-09-14）**：原 Phase 7 为 XL 汇聚桶，捆绑 8 项能力，其中 Google 双向/iCloud 在 PRD 中本就标为 optional/后续、付款为 Could 优先级。为保证每份 PRP plan「单遍可实现」，Phase 7 拆为 **7a–7e**：**7a**（本轮）交付准备最充分、依赖最内聚的多用户核心；其余按能力独立成阶段，均依赖 7a。

**Phase 7a: Team/Parent/Student Logins + Reschedule Requests（多用户核心）**
- **Goal**: 把 solo 工具变成小型多用户产品的第一步——让家长/学生登录、只看到自己（孩子）的课表，并能自助申请改期、由教师审批。
- **Scope**: 家长/学生账号**开通**（导师从后台创建，微信友好的无邮箱占位账号，非自助注册）；**多角色登录门户 `/portal`**（复用 Phase-4 `getStudentLessonsForTenant` + `ScheduleCard`，**行级隔离**：家长只见自己孩子）；**改期申请→教师审批工作流**（`rescheduleRequest` 申请→审批调用既有 `rescheduleLessonCore` 移课，冲突同样拦截）；**RBAC 行级硬化**（在既有 `rescheduleRequest` 角色权限之上增加 user↔student 归属校验，新增 `portalLink` 关联表）；PIPL/未成年人**数据处理告知 + 首登同意**。
- **Success signal**: 导师能开通家长/学生登录；家长登录只看到自己孩子的课表；家长能提交改期申请且教师可审批（自动移课、冲突被拦）或拒绝；跨家庭/跨租户数据零泄漏（测试证明）。

**Phase 7b: Reminders & Notifications**
- **Goal**: 自动提醒 + 改期结果通知，减少人工触达。
- **Scope**: 在盒 cron（Coolify 定时/node-cron）；课前提醒；改期通过后通知家长；渠道选型（邮件/短信/微信）。量增后可上 BullMQ+Redis 与 Message Batches API。依赖 7a。

**Phase 7c: MCP OAuth 2.1**
- **Goal**: 让 MCP connector 支持多用户。
- **Scope**: 从静态 bearer 升级到 OAuth 2.1（WorkOS AuthKit，`withMcpAuth` + RFC 9728，校验 token aud、不转发上游）。依赖 6 + 7a。

**Phase 7d: (optional) Google Two-way Sync**
- **Goal**: 可选的双向日历同步与受邀人邀请。
- **Scope**: Google 双向 + 邀请家长/学生为受邀人（用户 OAuth，发布状态设 Production 免 7 天失效，watch push 通道续期 cron，处理 410 fullSyncRequired）；仅确需在 Apple 内直接编辑时才做 iCloud CalDAV。依赖 7a。

**Phase 7e: Payments & Credits**
- **Goal**: 学费/课时追踪落地。
- **Scope**: 学费/课时包/付款状态（数据模型 `payment`/`creditPackage` 已在 Phase 1 预留）。依赖 7a。

### Parallelism Notes

- **Phase 3 与 4 可并行**：都只依赖 Phase 2 的排课数据；一个走"教师自己的日历订阅"，一个走"家长导出/分享"，互不阻塞。
- **Phase 5 与 6 可并行**：报告（5）依赖 Phase 2 + Phase 4 的模板/数据沉淀；MCP（6）依赖 Phase 2 的领域模型；两者互不依赖。
- **Phase 7 已拆分**：原汇聚阶段拆为 **7a–7e**，均依赖 3/4/5/6 落地。**7a**（多用户核心：登录门户 + 改期审批 + RBAC 硬化 + 告知页）为其余子阶段的前置；**7b（提醒）与 7c（MCP OAuth）可并行**；**7d（Google 双向，optional）与 7e（付款）**按需推进，互不阻塞。
- MVP 关键路径 = **1 → 2 →（3 ∥ 4）**；报告与 MCP 属增强，可在 MVP 稳定后并行推进；7a 是「solo → 小团队产品」的第一步。

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| MVP 核心功能 | 排课 + 自动冲突检测 | 导出 / 日历同步 / 报告 | 用户选定；是其余功能的地基，直接命中"避免冲突" |
| 日历同步方向（目标态 vs MVP） | 目标双向；**MVP 单向发布** | 纯单向 / 纯双向 | 用户目标为双向，但 MVP 单向以规避冲突解决复杂度，双向按 provider 延后 |
| Apple 日历（MVP） | 只读 .ics/webcal 订阅 | CalDAV 双向 / 只做 Google | 用户选定；Apple 无官方 API，订阅零凭证、零风险、最省事 |
| 家长获取课表（MVP） | 导出（PNG/PDF/.ics）+ 只读分享链接 | 仅导出 / 家长登录门户 | 用户选定；无登录即可覆盖核心沟通痛点 |
| 部署地区 / 托管 | 香港/海外 VPS + Coolify | 大陆(需 ICP) / Vercel+Supabase | 用户选定 HK；免备案、离微信近、CJK 渲染易、Coolify 近零运维 |
| 学费/付款追踪 | MVP 不做，数据模型预留 | 完全不做 / MVP 就做 | 用户选定；聚焦排课/报告，保留扩展位 |
| AI 报告数据隐私 | 可直接发学生姓名+笔记给 Claude API | 先匿名化 / 不用 AI | 用户选定；最简单效果最好；数字仍从 DB 渲染 + 教师审核门禁 |
| 日历受邀人 / Google 双向 | **optional，后续再做**（用户 OAuth）；MVP 只做订阅 | MVP 就做双向 + 邀请 | 教师主用 Apple、订阅已够用；双向+邀请延后为可选增强，届时用用户 OAuth 并尽早验证 |
| 移动端形态 | 响应式可安装 PWA | 原生 App / Capacitor 壳 | 一套代码、免商店；接受 iOS PWA 限制，提醒用邮件/短信兜底 |
| MCP 鉴权（MVP） | 静态 bearer token | OAuth 2.1 | 单用户即时可用；多用户阶段再上 WorkOS AuthKit OAuth 2.1 |
| 教师本人主日历 | **Apple 日历** | Google / 两者 | 只读订阅完美覆盖 Apple 查看需求，iCloud CalDAV 写入可长期不做 |
| 自动提醒（MVP） | **不做** | MVP 就做 | 用户选定；延后到多角色阶段再定渠道 |
| 家长/学生权限 | **需写权限（自助申请改期）+ 教师审批** | 严格只读 | 用户选定；改期走"申请→审批"流而非直接编辑 |
| 数据处理告知 | **在服务条款/家长告知中声明** | 不声明 | 用户选定；未成年人数据，PIPL 合规透明 |
| 12 个月规模 | 约 5 门课程、**15-30 名学生** | — | 远低于 100 用户；Redis/队列、OAuth 验证、MCP OAuth 2.1 均可长期延后 |
| 测试与部署 | **Docker 容器**（多阶段 Dockerfile + docker-compose，Coolify 编排同一镜像） | 裸机 / PaaS | 用户选定；容器化保证本地测试=生产一致、可移植、少运维 |

---

## Research Summary

**Market Context**
- 用户明确要求跳过市场/竞品调研（个人自用），本 PRD 未做外部竞品对比。核心问题与成功指标基于用户第一手陈述，**属待验证假设**。

**Technical Context**（来自后台并行技术可行性调研，7 agents，0 失败）
- **总体可行性 HIGH**：六维度均为成熟路径；唯一难点双向同步已在 MVP 规避。
- **Apple 日历**：iCloud **无官方 REST API**；只读 webcal 订阅（`ical-generator`，稳定 UID、`TZID=Asia/Shanghai`、无鉴权墙）是最低风险 MVP；CalDAV 写入（`tsdav >= 2.1.4`，Apple ID + 2FA 专用密码）仅后续按需；EventKit 不可服务端调用。
- **Google 日历**：教师自有日历可用**服务账号共享**免 OAuth 审核做 CRUD + syncToken 轮询；但**因需邀请受邀人**，双向阶段必须切**用户 OAuth**（calendar.events 敏感权限、人工审核、发布状态设 Production 以免 7 天 refresh token 失效）；watch push 需已验证 HTTPS 域名 + 通道续期 cron；处理 410 fullSyncRequired。
- **MCP connector**：`mcp-handler`（MCP TS SDK）挂 Next.js 路由，无状态 Streamable HTTP（SSE 已弃用），领域建模为 tools；MVP 静态 bearer，后续 OAuth 2.1（WorkOS AuthKit，`withMcpAuth` + RFC 9728），校验 token aud、不转发上游（confused-deputy）。
- **导出/分享**：一套模板派生 PNG（Playwright + CJK 字体 + 二维码，微信主投递）/ 只读 token 页 / .ics；批量循环 + `archiver` ZIP，按家长切分。避免 Satori/@vercel/og 渲染中文（无 CSS grid + 500KB 边缘包放不下 CJK 字体，静默豆腐）。
- **报告**：数据建模 Course 模板 vs ClassSection/Offering 学期实例 + Lesson/Attendance/Grade/Note + ProgressReport；`@react-pdf/renderer` `renderToBuffer()` 免 Chromium <500ms（内嵌 Noto Sans SC）；Claude 单次调用起草（结构化数据在用户轮、rubric 在缓存系统提示），数字从 DB 渲染 + 教师审核门禁；量大再上 BullMQ+Redis / Message Batches API（省 50%）。
- **技术栈**：Next.js 16（App Router / React 19，PWA）+ 自有 Postgres + Drizzle + Better Auth（org/RBAC）+ 单台 HK VPS/Coolify/Docker + 在盒 cron；报告 @react-pdf、微信卡片 Playwright、.ics ical-generator。中文字体全链路第一天处理；授权在数据层强制（非 middleware-only，CVE-2025-29927）。

---

*Generated: 2026-09-12 12:07 EDT（2026-09-12 修订：Open Questions 已解决并回填 Google 双向 optional / MVP 免提醒 / 家长写权限 / 数据处理告知 / Apple 主日历 / 15-30 学生规模 / Docker 容器化）*
*Status: DRAFT - needs validation*
