# PR Review: #6 — docs(phase-4): Parent Sharing & Export (WeChat-first) plan

**Reviewed**: 2026-09-13
**Author**: Jadyn Wu (YuudachiXMMY)
**Branch**: worktree-prp-phase4-parent-sharing-plan → main
**Decision**: APPROVE (with comments)

## Summary

Phase 4（家长分享与导出）实现完整、结构清晰，安全边界处理到位。多租户/单学生数据切片经审查无跨租户或跨学生泄漏；导出路由全部经过鉴权 + 权限校验；capability token 不可猜测、可轮换/撤销；`/s/<token>` 双重 noindex + PIPL 告知齐全。typecheck、lint、34 项单元测试全部通过。无 CRITICAL/HIGH 问题。合并前建议关注 1 个 MEDIUM（Playwright 单例失败后永久不可恢复）。

标题为 `docs(...plan)`，但 PR 实际已包含完整实现代码（+6458/-18，31 文件）——标题与内容不符，建议合并时更新标题为 `feat(phase-4): ...`。

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM

**M1 — Playwright 单例在启动失败/断连后永久不可恢复** · `src/lib/browser.ts:7-20`
`browserP` 一旦缓存了一个 rejected promise（`chromium.launch()` 瞬时失败、系统 Chromium 缺失等），此后每次 PNG/ZIP 导出都会返回同一个失败的 promise，直到进程重启。同理，常驻 browser 若崩溃/断连，`browserP` 会 resolve 出一个已失效的 `Browser`，`newContext()` 每次都抛错。在长驻的 standalone server 中，整个 PNG 功能会因一次偶发故障而永久失效。
建议：`getBrowser()` 在 launch 失败时 `browserP = null`（允许下次重试）；并在取用前检查 `browser.isConnected()`，断连则重建。

### LOW

**L1 — `ensureActiveShare` 竞态未优雅处理** · `src/app/dashboard/students/share-data.ts:25-34`
两个并发 create 都读到 null → 都 insert → partial-unique 索引拒绝第二个，返回 DB 错误（500）。分区唯一索引正确地防止了数据重复（无脏数据），但代码注释称其"guards the getOrCreate race"略有夸大——它防的是脏数据，不是错误。前端 `useTransition` 禁用按钮已降低概率。建议捕获唯一约束冲突后回查返回既有行。

**L2 — 渲染互斥锁无超时/队列上限** · `src/lib/browser.ts:24-42`
串行 mutex 无单任务超时；一次挂起的 Playwright 渲染会无限期阻塞后续所有导出，且重复的已鉴权请求会使队列无界增长。已鉴权、风险低，但建议为单次渲染加超时保护。

**L3 (nit) — 迁移文件缺末尾换行** · `drizzle/0003_nostalgic_jack_flag.sql:16`
drizzle 生成产物，无害。

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (`eslint .`) | Pass |
| Unit tests (5 非 DB 套件，34 tests) | Pass |
| Build (`next build`) | Skipped — 仅 typecheck 覆盖类型；Turbopack 全量构建未在本环境运行 |
| DB 集成测试 | Skipped — 无在线迁移后的 Postgres（infra 受限，已在 plan 中记录） |

## Files Reviewed

- `src/db/schema/share-link.ts` (Added) — 分区唯一索引 + 复合 FK 级联，正确
- `src/db/schema/index.ts` (Modified) — 导出顺序正确（`./relations` 之前）
- `drizzle/0003_*.sql` + `meta/*` (Added) — 迁移与 schema 一致
- `src/lib/share.ts` (Added) — 公开读例外，按 token 解析的 tenantId/studentId 严格作用域 ✓
- `src/lib/schedule-card.tsx` (Added) — 纯内联样式，Web 与 PNG 共用同一组件
- `src/lib/browser.ts` (Added) — Playwright 单例 + 互斥（见 M1/L2）
- `src/lib/qr.ts` (Added) — QR H 级纠错
- `src/lib/ical-feed.ts` (Modified) — 仅追加 `cardWindow`，未触碰 Phase-3 逻辑 ✓
- `src/app/dashboard/students/share-data.ts` (Added) — forTenant 主干（见 L1）
- `src/app/dashboard/students/share-actions.ts` (Added) — 权限分级 read/update 正确
- `src/app/api/export/student/[studentId]/{png,ics}/route.ts` (Added) — 鉴权 + 权限 + `private, no-store` ✓
- `src/app/api/export/section/[sectionId]/route.ts` (Added) — 段归属校验 + 逐学生切片 + ZIP 名净化 ✓
- `src/app/s/[token]/page.tsx` + `not-found.tsx` (Added) — 公开只读，双重 noindex，token 解析作用域 ✓
- `src/app/privacy/page.tsx` (Added) — PIPL 告知
- `src/app/dashboard/students/export-panel.tsx` + `page.tsx`, `courses/page.tsx` (Added/Modified) — 导出 UI
- `next.config.ts` (Modified) — `serverExternalPackages` + `/s/:token*` X-Robots-Tag
- `src/env.ts` (Modified) — 可选 `PLAYWRIGHT_CHROMIUM_PATH`
- `Dockerfile` (Modified) — runtime 切 node:24-slim + chromium + fonts-noto-cjk
- `tests/{schedule-card,share-slicing}.test.ts` (Added) — 19 项纯函数测试
- `.claude/PRPs/{plans,prds}/*` (Added/Modified) — 计划文档 + PRD 状态
