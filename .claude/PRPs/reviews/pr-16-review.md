# PR Review: #16 — docs(prp): plan — minimax-cn as switchable report provider

**Reviewed**: 2026-09-15
**Author**: YuudachiXMMY (Jadyn Wu)
**Branch**: worktree-prp-plan-minimax-provider → main
**Decision**: COMMENT (draft PR, docs-only)

## Summary
单文件纯文档 PR:新增 minimax-cn 可切换 provider 的 PRP 实施计划。计划技术自洽,代码片段与真实源文件吻合,MiniMax 端点/模型名经官方文档佐证。无 CRITICAL/HIGH/MEDIUM;仅 3 条 LOW 提示,均已在计划的 Risks/GOTCHA 中预留退路。批准方向,待草稿转正常后可合并。

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM
None

### LOW
- **L1 — `max_completion_tokens` 兼容性**(Task 3):OpenAI Chat 路由该字段有效,MiniMax 亦按此文档要求;计划已注明失败时退回 `max_tokens: 2048`。实施时二选一,勿同传。
- **L2 — 默认模型名随目录演进**(Task 2):`MiniMax-M3` 经官方文档确认为当前旗舰,正确;但 MiniMax 目录迭代快(M2/M2.1/M2.5/M2.7/M3 并存),实施时顺手复核一次。已由 env `MINIMAX_MODEL` 覆盖,风险可控。
- **L3 — 推理模型正文取值**(Task 3):M3 为 agentic/推理型模型,`choices[0].message` 可能含 `reasoning_content`;计划取 `.content` 并 `?? ''` 兜底。实施时确认最终叙述确实落在 `.content`(而非 reasoning 字段),必要时补一例"空 content"测试(计划 Edge Cases 已列为可选)。

## 正面确认(核验通过)
- 计划内 `report-draft.ts` / `env.ts` / `actions.ts` / `report.test.ts` 片段均与仓库当前源文件逐行吻合(非杜撰)。
- `DraftResult` 契约与 `progressReport.model` 自由字符串列不变 → 无需 DB 迁移,`report-core.ts`/`actions.ts` 免改,判断正确。
- 沿用「抛中文 Error → actions catch 以 data 回传」模式,避免 React #441,与既有约定一致。
- 测试 mock 结构(`vi.mock('openai')` default class + `chat.completions.create`)正确对应 `new OpenAI().chat.completions.create`,并断言反向 provider 未被调用,隔离到位。
- CN base URL `https://api.minimaxi.com/v1`(尾字母 i)与区域匹配告警准确;`.env.example` 用占位符,无密钥泄漏。

## Validation Results
| Check | Result |
|---|---|
| Type check | Skipped(docs-only,无代码变更) |
| Lint | Skipped |
| Tests | Skipped |
| Build | Skipped |

## Files Reviewed
- `.claude/PRPs/plans/add-minimax-cn-report-provider.plan.md` (Added, +473)
