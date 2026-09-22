# 生产就绪审查报告 — `main` → `prod/ithaca` 部署增量

- **日期**：2026-09-22
- **范围**：`main` 相对生产分支 `origin/prod/ithaca` 的部署增量 —— **47 提交 / 123 文件 / +12827 −347 行**（即下次部署将上线的全部内容，累积自 PR #64–#70）
- **方法**：分片版 orch-review（自建 workflow）—— 按模块切 7 个分片，每个分片跑质量 / TypeScript / React / 安全 / 测试覆盖多维 reviewer 并行；每条 CRITICAL/HIGH 由独立"怀疑者"agent 对抗验证，对照 `main` 上**真实已合入代码**判定，fail-closed（验证不了/无法自信驳回的一律保留为阻断项）
- **规模**：24 个 agent（21 reviewer + 3 对抗验证）、0 错误、~168 万 token、~7.8 分钟
- **判定**：**CHANGES_REQUESTED** —— 3 阻断（HIGH，3/3 验证确认，置信度 0.95）+ 7 建议（MEDIUM/LOW）

---

## 分片矩阵

| 分片 | 文件 | 大小 | 维度 | 结果 |
|---|---|---|---|---|
| auth | 9 | 15KB | 质量+TS+安全 | 1 建议 |
| db-schema | 8 | 13KB | 质量+TS+安全 | **零发现（干净）** |
| lib | 18 | 49KB | 质量+TS+安全 | 1 建议 |
| app-dashboard | 31 | 53KB | 质量+TS+React+安全 | 1 建议 |
| app-edge | 13 | 26KB | 质量+TS+React+安全 | 3 建议 |
| infra | 12 | 57KB | 质量+TS+安全 | 1 阻断 |
| tests | 26 | 76KB | 测试覆盖 | 2 阻断 |

---

## 🔴 阻断项（3，均 HIGH，均已对抗验证确认）

### B1 — MCP 通道无视账号停用/封禁（唯一的真运行时安全缺陷）

- **文件**：`src/auth/mcp-context.ts`（`mcpAuthContextFor`）
- **维度**：安全（infra 分片）· 验证置信度 0.95
- **问题**：MCP 连接器走静态 `MCP_BEARER_TOKEN` + env `MCP_USER_ID/MCP_ORG_ID`，`mcpAuthContextFor` **只查 `member.role`，从不检查 `user.banned`**。而 `deactivateStaffCore`（`src/auth/staff.ts:146`）的停用语义是"立即锁死"：翻转全局 `user.banned=true` + 删除该用户全部会话——但**不改 `member` 行**（role 不变）。MCP 通道没有会话可删、又不看 banned，因此对停用/封禁完全无感。
- **后果**：被停用/封禁的员工（离职、账号泄露），只要其 user id 恰为 `MCP_USER_ID`，MCP 全部工具照常可用（`list_students` 含 `parentWechat` PII、排课/改期、读课堂笔记、生成带分享链接的家长消息），直到运维手动改 env 并重启容器。直接违背该功能自身注释里 "IMMEDIATE lock-out" 的设计意图。`mcp-context.ts` 的注释甚至自称 "so a demoted/removed principal loses access immediately"——但只对 demote/remove 成立，对 ban 失效。
- **修法**：`mcpAuthContextFor` innerJoin `user` 查 `banned`/`banExpires`，镜像 Better Auth 登录门语义（`banned && (banExpires == null || banExpires > now)` 即封禁生效）抛 `AuthError`。

### B2 — F4 崩溃循环守卫零回归测试（测试缺口，非运行时缺陷）

- **文件**：`scripts/cleanup-room-overlaps.ts`
- **维度**：测试覆盖（tests 分片）· 验证置信度 0.95
- **问题**：该脚本是唯一挡住"存量库 0015 EXCLUDE 约束迁移崩溃循环"的守卫（`set -e` + `restart:unless-stopped` 会永久重试），但整个 `tests/` 无一引用它；而结构相同的兄弟修复 `cleanup-orphan-tenants.ts` 在同批 diff 里有 90 行完整测试。幂等快路径（`to_regclass`/`pg_constraint` 检查）、重叠自连接、"取消较晚课"tie-break 全无测试——回归（如破坏快路径、或反转 tie-break 致两节都幸存）会静默重现部署崩溃循环。
- **修法**：把脚本重构为导出可测函数（对齐兄弟脚本的设计），新增 `tests/cleanup-room-overlaps.test.ts` 覆盖快路径、重叠自连接谓词、tie-break。

### B3 — F5 quick-grade 23505 竞态恢复路径零回归测试（测试缺口，非运行时缺陷）

- **文件**：`src/app/dashboard/teach/[sectionId]/data.ts`（`upsertLessonStudentGradeCore`）
- **维度**：测试覆盖（tests 分片）· 验证置信度 0.95
- **问题**：F5 的 select-then-insert 竞态恢复路径（catch `23505` → 重新 select + update，last-writer-wins）以及 `isUniqueViolation` 分类**均未被任何测试触达**（现有测试只走顺序 happy-path 的 update 分支和 RBAC 守卫）。该修复依赖迁移 0020 的部分唯一索引 + 这段 catch 代码**共同正确**。驱动/ORM 升级改变 23505 呈现方式（破坏 `isUniqueViolation`）、或重构去掉 try/catch，会静默重现重复 grade 行 → 被 report-stats 重复计入家长 PDF 均分。
- **修法**：新增 `isUniqueViolation` 单测（cause-chain）+ DB 集成测试（重复插入触发 23505 且被 `isUniqueViolation` 捕获；并发双写只留一行且不抛）。

> **说明**：3 条阻断里只有 **B1 是真实的行为缺陷**（随部署上线）。B2/B3 是"修复本身正确、但缺回归护栏"——门禁按 fail-closed 把测试缺口也计为阻断。

---

## 🟡 建议项（7，MEDIUM/LOW，不阻断）

| 编号 | 严重度 | 文件 | 问题 |
|---|---|---|---|
| A1 | MEDIUM | `src/auth/staff.ts` | 多机构用户停用/复用守卫（拒绝对 >1 机构成员做全局封禁）缺直接测试 |
| A2 | MEDIUM | `src/app/dashboard/reports/cross-border-ack.tsx` | `role="alertdialog"` 用在非模态内联块，无焦点陷阱——语义与实现不符 |
| A3 | MEDIUM | `src/app/api/reports/section/[sectionId]/route.ts` | ZIP 条目清洗仍用旧的本地 `safe()`，未切到 F3 加固后的共享 `safeZipEntryName`；注释"mirror …"已失真（quality + typescript 两个 reviewer 各报一次，同一处） |
| A4 | MEDIUM | `scripts/purge-tenant.ts` | `tx as unknown as Sql` 双重强转掩盖 postgres.js `Sql`/`TransactionSql` 真实类型不兼容（最危险的销毁脚本里的潜在维护陷阱） |
| A5 | LOW | `src/lib/report-stats.ts` | `averageScore()` 已被 `averagePercentage()` 取代，成死代码 |
| A6 | LOW | `src/app/api/health/route.ts` | 健康探活 `Promise.race` 的超时定时器未 `clearTimeout` |

---

## ✅ 干净的面（零发现）

- **db-schema / 迁移 0018-0020**：迁移安全、幂等、tenant_id 隔离全部通过（历史崩溃循环点已解）。
- **跨租户隔离 / 注入 / 密钥泄露 / PII 越境**：所有 security reviewer 均 APPROVE，无确认漏洞。
- auth/lib/app-dashboard/app-edge 的 SQL 注入、IDOR、prompt 注入、能力 token 作用域——均未发现。

整体安全姿态稳；部署前唯一需修的真实缺陷是 **B1**，B2/B3 补回归测试，建议项择机处理。本报告对应的落地修复见同 PR 后续提交。
