# PR Review: #18 — fix(compose): inject report-drafting env into app container

**Reviewed**: 2026-09-15
**Author**: Jadyn Wu (YuudachiXMMY)
**Branch**: worktree-fix-compose-report-env → main
**Decision**: APPROVE with comments (draft PR → posted as COMMENT)

## Summary
仅一处 config 改动:给 `docker-compose.yml` 的 `app` 服务补齐报告起草的 provider 与凭据环境变量。根因分析准确,默认值与 `src/env.ts` 完全一致,无安全问题。可以合并。

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM
None

### LOW
- **`test` 服务未转发报告变量**(docker-compose.yml:62-64):`test` 服务只跑 `migrate + npm run test`,不起草报告,因此无需转发。仅作记录,非问题。
- **可选替代方案**:也可用 `env_file: .env` 一次性注入所有 `.env` 变量,省去逐个枚举。但当前显式白名单方式更可控(只转发已知变量),且与文件内既有风格一致——保持现状即可。

## Verification
- `src/env.ts` 默认值与 compose 逐一比对一致:`REPORT_PROVIDER=anthropic`、`ANTHROPIC_MODEL=claude-opus-4-8`、`MINIMAX_MODEL=MiniMax-M3`、`MINIMAX_BASE_URL=https://api.minimaxi.com/v1`。
- `emptyStringAsUndefined: true` 确认存在 → 空字符串默认值(`${ANTHROPIC_API_KEY:-}`)会被视为未设,满足 `.optional()`,不会触发 zod 校验失败。
- `next.config.ts:6` 确认 `output: 'standalone'`,佐证 standalone `server.js` 不加载 `.env`,故必须在此注入。
- 无硬编码密钥,凭据全部经 `${VAR}` 从宿主环境插值。

## Validation Results

| Check | Result |
|---|---|
| Type check | Skipped (config-only change, no TS touched) |
| Lint | Skipped (config-only) |
| Tests | Skipped (config-only) |
| Build | Skipped (config-only) |
| `docker compose config` (main checkout, prior session) | Pass — resolves `REPORT_PROVIDER: minimax` + MiniMax key/model/base URL |

## Files Reviewed
- docker-compose.yml (Modified, +10 −0)
