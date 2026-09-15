# Implementation Report: minimax-cn 可切换报告起草 provider

## Summary
在进度报告 AI 起草中引入由 `REPORT_PROVIDER` 环境变量切换的 provider 抽象:保留原 Anthropic(Claude)路径,新增经 `openai` SDK 指向 MiniMax(中国区)OpenAI 兼容端点的 MiniMax 路径。无 Anthropic Key 的部署可改用 MiniMax 起草报告。无 DB schema 变更,`DraftResult` 契约不变。

实施依据:`.claude/PRPs/plans/add-minimax-cn-report-provider.plan.md`,并已核对 PR #16 评审(`pr-16-review.md`)的 3 条 LOW 提示。

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Small | Small(与预估一致) |
| Files Changed | 5(4 UPDATE + package.json/lockfile) | 6(含 pnpm-lock.yaml) |
| 迁移/DB 变更 | 无 | 无 |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | 安装 openai 依赖 | ✅ Complete | pnpm add openai → openai@7.15.0 |
| 2 | 扩展 env.ts(REPORT_PROVIDER / MINIMAX_*) | ✅ Complete | 沿用 t3-env + zod,`z.url()` 默认 CN base URL |
| 3 | 重构 report-draft.ts 为 provider 分派 | ✅ Complete | 入口 draftNarrative + 私有 draftWithAnthropic / draftWithMiniMax |
| 4 | 更新 .env.example | ✅ Complete | 全注释,含区域匹配提示,无真实 Key |
| 5 | 补充测试(MiniMax 路径 + 未配 Key) | ✅ Complete | +2 用例;扩展 fakeEnv 与 openai mock |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis (typecheck) | ✅ Pass | 零类型错误;`max_completion_tokens` 被 openai@7.15.0 类型接受(评审 L1 无需退回 max_tokens) |
| Lint | ✅ Pass | eslint 零错误 |
| Unit Tests | ✅ Pass | tests/report.test.ts 15/15 通过(含新增 2 例)。其余 14 个 DB 集成测试因本地无 Postgres(`DATABASE_URL`/连接)失败 —— 预存在,与本改动无关 |
| Build | ✅ Pass | `next build` 成功,openai 打包正常,server-only 约束未破 |

## Files Changed

| File | Action | Notes |
|---|---|---|
| `package.json` | UPDATE | +`openai: ^7.15.0` |
| `pnpm-lock.yaml` | UPDATE | 锁定 openai 及其依赖 |
| `src/env.ts` | UPDATE | +REPORT_PROVIDER / MINIMAX_API_KEY / MINIMAX_MODEL / MINIMAX_BASE_URL |
| `src/lib/report-draft.ts` | UPDATE | provider 分派;Anthropic 逻辑逐行移入私有函数,新增 MiniMax 路径 |
| `.env.example` | UPDATE | 新增 provider 切换与 MiniMax 段(全注释) |
| `tests/report.test.ts` | UPDATE | openai mock + fakeEnv 扩展 + 2 例 MiniMax 用例 |

## Review LOW Findings 处置

| # | 提示 | 处置 |
|---|---|---|
| L1 | `max_completion_tokens` 兼容性 | typecheck 通过,openai@7.15.0 接受该字段;未同传 max_tokens。无需退回 |
| L2 | 默认模型名 `MiniMax-M3` 随目录演进 | 保留为默认值,已由 `MINIMAX_MODEL` env 覆盖,风险可控 |
| L3 | 推理模型正文取值 | 取 `choices[0].message.content` 并 `?? ''` 兜底;忽略 `reasoning_content`。"空 content" 测试为计划标注的可选项,本次未追加 |

## Deviations from Plan
- 归档目标:命令参数为评审文件 `pr-16-review.md`,但该文件仅存在于未合并的 `prp-plan-minimax-provider` worktree,不在当前 checkout。实际实施并归档的是它所评审的计划 `add-minimax-cn-report-provider.plan.md`。
- 测试执行需在进程环境提供 `DATABASE_URL`(vitest 经 `dotenv/config` 加载,本地 worktree 无 `.env`);用占位值即可,`@/db` 惰性建池不实际连库。

## Issues Encountered
- 全量 `pnpm test` 有 14 个 DB 集成测试文件因缺 `DATABASE_URL`/无本地 Postgres 而失败。经确认为环境依赖、基线同样如此,非本改动引入的回归。已单独运行 `tests/report.test.ts` 验证本改动(15/15 绿)。

## Tests Written

| Test File | New Tests | Coverage |
|---|---|---|
| `tests/report.test.ts` | 2 | MiniMax 组装+返回、MiniMax 未配 Key 抛错且不调用 API(并断言反向 provider 未被调用) |

## Next Steps
- [ ] Code review via `/code-review`
- [ ] 合并后可选:追加"MiniMax 空 content"边界测试(计划 Edge Cases 可选项)
