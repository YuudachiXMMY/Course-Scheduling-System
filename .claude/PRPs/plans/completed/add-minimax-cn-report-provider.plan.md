# Plan: 添加 minimax-cn 作为可切换报告起草模型

## Summary

在进度报告 AI 起草功能中引入 MiniMax(中国区)作为可切换的 LLM provider。保留现有 Claude(Anthropic)路径,新增一个由环境变量 `REPORT_PROVIDER` 选择的 MiniMax 路径,通过 `openai` SDK 指向 MiniMax 的 OpenAI 兼容端点。无 Anthropic Key 的部署可改用 MiniMax 起草报告。

## User Story

作为一名使用本系统的独立教师/机构管理员,
我希望在没有 Anthropic(Claude)API Key 的情况下也能用 MiniMax(国内可直接访问)起草进度报告,
以便在国内网络与账号条件下顺利使用 AI 起草能力,而不必依赖境外 Claude 服务。

## Problem → Solution

**现状**:`draftNarrative()` 硬编码只走 Anthropic SDK;`ANTHROPIC_API_KEY` 未配置时报告起草直接抛错 `未配置 Claude API Key（ANTHROPIC_API_KEY），无法起草报告`,功能不可用(见上一次会话用户遇到的问题)。

**目标**:引入 provider 抽象。`REPORT_PROVIDER=anthropic`(默认,行为不变)或 `REPORT_PROVIDER=minimax`(用 MiniMax-CN 起草)。两条路径共用同一套 rubric 提示词与 `DraftResult` 契约,`progressReport.model` 如实记录所用模型名。

## Metadata

- **Complexity**: Small
- **Source PRD**: N/A(自由文本需求)
- **PRD Phase**: N/A
- **Estimated Files**: 5(4 UPDATE + package.json/lockfile)

---

## UX Design

内部/后端变更 —— 无直接用户可见 UI 变化。唯一的用户可感知差异:

- 配置 `REPORT_PROVIDER=minimax` + `MINIMAX_API_KEY` 后,`/dashboard/reports → 生成草稿` 在没有 Anthropic Key 的环境也能成功产出草稿。
- MiniMax 路径下、未配 `MINIMAX_API_KEY` 时,报错文案由 `未配置 Claude API Key…` 变为 `未配置 MiniMax API Key（MINIMAX_API_KEY），无法起草报告`,通过既有的 `ReportResult` as-data 通道原样回传到面板(不会变成 React #441)。

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| 生成草稿(无 Claude Key) | 永远失败:`未配置 Claude API Key…` | 若切到 minimax + 配好 Key,可成功起草 | 需设置两个 env |
| 报告 `model` 字段 | 恒为 `claude-*` | 记录实际 provider 的模型名(如 `MiniMax-M3`) | 无 schema 变更,`model` 已是自由字符串列 |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0(关键) | `src/lib/report-draft.ts` | 1-41(全文) | 本次改造主体;要在此加 provider 分派 |
| P0(关键) | `src/env.ts` | 1-34(全文) | 新增 env 变量的唯一入口,须沿用 t3-env + zod 模式 |
| P1(重要) | `tests/report.test.ts` | 7-18, 131-165 | 复刻其 env/SDK mock 模式为 MiniMax 补测 |
| P1(重要) | `src/lib/report-prompt.ts` | 24-42 | `buildReportPrompt` 返回 `{ system, userJson }`,两条 provider 路径共用 |
| P2(参考) | `src/lib/report-core.ts` | 23-45 | 确认 `draft.narrative/model/rubricVersion` 契约不变,写库逻辑不需改 |
| P2(参考) | `.env.example` | 全文 | 新增变量文档,复刻 Anthropic 段注释风格 |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| MiniMax OpenAI 兼容端点(CN) | platform.minimaxi.com/docs/api-reference/text-openai-api | Base URL `https://api.minimaxi.com/v1`(注意尾字母 i);`client.chat.completions.create`;`Authorization: Bearer` |
| MiniMax 模型 ID | 同上 | 最新 `MiniMax-M3`;其它见到的:`MiniMax-M2.7`、`MiniMax-M2.7-highspeed`。用作默认值 `MiniMax-M3` |
| 区域匹配 | minimax-ai.chat/docs/minimax-api-key-base-url | **Key 与 host 必须同区**:CN Key 配 `api.minimaxi.com`,Global Key 配 `api.minimax.io`。区域不匹配会 404/鉴权失败 |
| 输出上限参数 | MiniMax OpenAI-compat docs | OpenAI Chat 路由用 `max_completion_tokens`(不是 Anthropic 的 `max_tokens`) |
| openai SDK 自定义 baseURL | openai npm(node) | `new OpenAI({ apiKey, baseURL })`;响应取 `res.choices[0].message.content` |

> 注:`res.choices[0].message` 可能含 `reasoning_content`,最终正文在 `.content`。取 `.content` 即可。

---

## Patterns to Mirror

以下均为代码库实际片段,严格照此风格写。

### ENV_DECLARATION
```ts
// SOURCE: src/env.ts:16-27
    MCP_BEARER_TOKEN: z.string().min(32).optional(), // static bearer; generate: openssl rand -base64 48
    // P5: Claude drafting for progress reports. OPTIONAL so the app boots without it — report
    // drafting fails fast with a clear message when unset; everything else works. Model defaults
    // to Opus 4.8; set ANTHROPIC_MODEL=claude-haiku-4-5 / claude-sonnet-5 to trade cost for tier.
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_MODEL: z.string().min(1).default('claude-opus-4-8'),
```

### PROVIDER_CALL(现有 Anthropic 路径,作为要重构的基线)
```ts
// SOURCE: src/lib/report-draft.ts:17-40
export async function draftNarrative(data: ReportData): Promise<DraftResult> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('未配置 Claude API Key（ANTHROPIC_API_KEY），无法起草报告')
  }
  const { system, userJson } = buildReportPrompt({ rubricVersion: RUBRIC_VERSION, data })
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

  const res = await client.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 2048,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userJson }],
  })

  const narrative = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()

  return { narrative, model: env.ANTHROPIC_MODEL, rubricVersion: RUBRIC_VERSION }
}
```

### ERROR_HANDLING(错误以 data 回传,不抛穿到 Server Action)
```ts
// SOURCE: src/app/dashboard/reports/actions.ts:59-63
  } catch (e) {
    // Keep the stack in server logs (the redacted message is all the client would otherwise get).
    console.error('createReportDraft failed', e)
    return { ok: false, error: e instanceof Error ? e.message : '生成报告失败' }
  }
```
> 含义:provider 函数里 `throw new Error('中文文案')` 即可,`actions.ts` 已把 message 原样回传给面板。无需改 actions/core。

### TEST_STRUCTURE(env + SDK 双 mock)
```ts
// SOURCE: tests/report.test.ts:7-18
const fakeEnv: { ANTHROPIC_API_KEY: string | undefined; ANTHROPIC_MODEL: string } = {
  ANTHROPIC_API_KEY: 'sk-test',
  ANTHROPIC_MODEL: 'claude-opus-4-8',
}
vi.mock('@/env', () => ({ env: fakeEnv }))
const createMock = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock }
  },
}))
```

### TEST_CASE(动态 import + 断言组装的请求)
```ts
// SOURCE: tests/report.test.ts:141-157
  it('composes the request ... and returns the text', async () => {
    createMock.mockResolvedValue({ content: [{ type: 'text', text: '小明表现稳定。' }] })
    const { draftNarrative } = await import('@/lib/report-draft')
    const res = await draftNarrative(sampleData)
    expect(res.narrative).toBe('小明表现稳定。')
    expect(res.model).toBe('claude-opus-4-8')
    const arg = createMock.mock.calls[0]![0]
    expect(arg.model).toBe('claude-opus-4-8')
  })
```

### ENV_EXAMPLE_DOC(注释风格)
```dotenv
# SOURCE: .env.example (Anthropic 段)
# Anthropic (Claude) — REQUIRED for AI-drafted progress reports (/dashboard/reports → 生成草稿).
# Without it, drafting is disabled and the UI shows a readable error instead of failing.
# ANTHROPIC_API_KEY=sk-ant-...
# ANTHROPIC_MODEL=claude-opus-4-8   # optional; default is claude-opus-4-8
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `package.json` / `pnpm-lock.yaml` | UPDATE | 新增 `openai` 依赖(`pnpm add openai`) |
| `src/env.ts` | UPDATE | 新增 `REPORT_PROVIDER` / `MINIMAX_API_KEY` / `MINIMAX_MODEL` / `MINIMAX_BASE_URL` |
| `src/lib/report-draft.ts` | UPDATE | 抽出 provider 分派;新增 `draftWithMiniMax`,保留 `draftWithAnthropic` |
| `.env.example` | UPDATE | 记录新变量与区域匹配注意事项 |
| `tests/report.test.ts` | UPDATE | 增加 openai mock 与 MiniMax 路径测试;补 `fakeEnv` 字段 |

## NOT Building

- 不改数据库 schema(`progressReport.model` 已是自由字符串列,直接存 `MiniMax-M3`)。
- 不做运行时/每报告的 provider 选择 UI —— 仅靠环境变量切换(本期范围)。
- 不实现 Claude→MiniMax 的自动降级/兜底(那是用户明确未选的方案二)。
- 不引入流式输出、function calling、图片/视频输入等 MiniMax 高级能力。
- 不移除或改动 Anthropic 路径的既有行为(含 prompt caching / 不传 temperature)。
- 不改 `report-core.ts` / `actions.ts` / `report-prompt.ts` 的逻辑。

---

## Step-by-Step Tasks

### Task 1: 安装 openai 依赖
- **ACTION**: 在项目根运行 `pnpm add openai`。
- **IMPLEMENT**: 让 `package.json` `dependencies` 出现 `"openai": "^x"`,并更新 `pnpm-lock.yaml`。
- **MIRROR**: 依赖排列风格同 `@anthropic-ai/sdk`(dependencies 段,字母序)。
- **IMPORTS**: 无。
- **GOTCHA**: 包管理器是 pnpm@10,勿用 npm/yarn 安装以免生成错误 lockfile。
- **VALIDATE**: `pnpm ls openai` 显示已安装;`node -e "require.resolve('openai')"` 不报错。

### Task 2: 扩展环境变量声明
- **ACTION**: 在 `src/env.ts` 的 `server` 块内 Anthropic 段之后新增 MiniMax 段。
- **IMPLEMENT**:
```ts
    // P8: 报告起草 provider 切换。默认走 Anthropic(行为不变);设为 'minimax' 改用 MiniMax(CN)。
    REPORT_PROVIDER: z.enum(['anthropic', 'minimax']).default('anthropic'),
    // MiniMax(中国区)OpenAI 兼容端点。OPTIONAL,以便 provider=anthropic 时无需配置即可启动。
    // 注意:CN Key 必须配 api.minimaxi.com(尾字母 i);Global Key 配 api.minimax.io,否则 404/鉴权失败。
    MINIMAX_API_KEY: z.string().min(1).optional(),
    MINIMAX_MODEL: z.string().min(1).default('MiniMax-M3'),
    MINIMAX_BASE_URL: z.url().default('https://api.minimaxi.com/v1'),
```
- **MIRROR**: `ENV_DECLARATION` 片段(`.optional()` + `.default()` + 行内中文注释)。
- **IMPORTS**: 无(`z` 已导入)。
- **GOTCHA**: `z.url()` 已在本文件用于 `DATABASE_URL`(zod 4);沿用同名法。`emptyStringAsUndefined: true` 表示 `.env` 里空值等于未设,default 会生效。
- **VALIDATE**: `pnpm typecheck` 通过;临时 `console.log(env.REPORT_PROVIDER)` 得到 `anthropic`(不留存)。

### Task 3: 重构 report-draft.ts 为 provider 分派
- **ACTION**: 将现有单函数拆为「入口 `draftNarrative` + 两个私有 provider 函数」。
- **IMPLEMENT**: 用下述完整文件替换 `src/lib/report-draft.ts`:
```ts
import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { buildReportPrompt, RUBRIC_VERSION } from '@/lib/report-prompt'
import type { ReportData } from '@/lib/report-stats'
import { env } from '@/env'

// P5/P8: 单次、无状态、无工具的 LLM 调用,起草报告叙述。teacher 审核门(draft → approved)在
// DB/actions 层;数字由 DB 渲染进 PDF,模型只写正文。P8 起支持按 REPORT_PROVIDER 切换 provider。

export interface DraftResult {
  narrative: string
  model: string
  rubricVersion: string
}

export async function draftNarrative(data: ReportData): Promise<DraftResult> {
  const { system, userJson } = buildReportPrompt({ rubricVersion: RUBRIC_VERSION, data })
  const { narrative, model } =
    env.REPORT_PROVIDER === 'minimax'
      ? await draftWithMiniMax(system, userJson)
      : await draftWithAnthropic(system, userJson)
  return { narrative, model, rubricVersion: RUBRIC_VERSION }
}

async function draftWithAnthropic(
  system: string,
  userJson: string,
): Promise<{ narrative: string; model: string }> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('未配置 Claude API Key（ANTHROPIC_API_KEY），无法起草报告')
  }
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const res = await client.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 2048,
    // Stable rubric → cached prefix; volatile per-student data → user turn (prompt-caching.md).
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userJson }],
    // NB: do NOT pass temperature / top_p / budget_tokens — Opus 4.8 rejects them (400).
  })
  const narrative = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
  return { narrative, model: env.ANTHROPIC_MODEL }
}

async function draftWithMiniMax(
  system: string,
  userJson: string,
): Promise<{ narrative: string; model: string }> {
  if (!env.MINIMAX_API_KEY) {
    throw new Error('未配置 MiniMax API Key（MINIMAX_API_KEY），无法起草报告')
  }
  // MiniMax(CN)OpenAI 兼容端点。区域必须与 Key 一致(api.minimaxi.com,尾字母 i)。
  const client = new OpenAI({ apiKey: env.MINIMAX_API_KEY, baseURL: env.MINIMAX_BASE_URL })
  const res = await client.chat.completions.create({
    model: env.MINIMAX_MODEL,
    // OpenAI Chat 路由用 max_completion_tokens(非 Anthropic 的 max_tokens)。
    max_completion_tokens: 2048,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userJson },
    ],
  })
  const narrative = (res.choices[0]?.message?.content ?? '').trim()
  return { narrative, model: env.MINIMAX_MODEL }
}
```
- **MIRROR**: `PROVIDER_CALL` 片段(Anthropic 逻辑逐行保留,只是移入 `draftWithAnthropic`)。
- **IMPORTS**: 新增 `import OpenAI from 'openai'`。
- **GOTCHA**:
  - `DraftResult` 契约不变,`report-core.ts` 无需改。
  - MiniMax 正文取 `choices[0].message.content`;`reasoning_content` 忽略。
  - 若 openai SDK 类型不认 `max_completion_tokens`,退用 `max_tokens: 2048`(MiniMax 兼容接受);切勿同时传两者。
  - 不给 MiniMax 传 `cache_control`(那是 Anthropic 专有)。
- **VALIDATE**: `pnpm typecheck` + `pnpm lint` 通过;Task 5 的单测覆盖两条路径。

### Task 4: 更新 .env.example
- **ACTION**: 在 Anthropic 段后追加 MiniMax + provider 切换说明。
- **IMPLEMENT**:
```dotenv
# 报告起草 provider 切换:anthropic(默认)| minimax
# REPORT_PROVIDER=anthropic

# MiniMax(中国区)— REPORT_PROVIDER=minimax 时用于 AI 起草进度报告。
# 注意:CN Key 必须配 api.minimaxi.com(尾字母 i);区域与 Key 不匹配会 404/鉴权失败。
# MINIMAX_API_KEY=
# MINIMAX_MODEL=MiniMax-M3                      # optional; default is MiniMax-M3
# MINIMAX_BASE_URL=https://api.minimaxi.com/v1  # optional; CN default
```
- **MIRROR**: `ENV_EXAMPLE_DOC` 片段(注释掉的 KEY=、行尾 optional/default 说明)。
- **IMPORTS**: 无。
- **GOTCHA**: 保持全部为注释(`#`),避免覆盖真实 `.env`;不要写入任何真实 Key。
- **VALIDATE**: 人工核对文案与 `src/env.ts` 默认值一致(`MiniMax-M3`、CN base URL)。

### Task 5: 补充测试(MiniMax 路径 + 未配 Key)
- **ACTION**: 在 `tests/report.test.ts` 增加 openai mock、扩展 `fakeEnv`,新增 MiniMax 用例。
- **IMPLEMENT**:
  1. 扩展 `fakeEnv` 类型与初值:
```ts
const fakeEnv: {
  REPORT_PROVIDER: 'anthropic' | 'minimax'
  ANTHROPIC_API_KEY: string | undefined
  ANTHROPIC_MODEL: string
  MINIMAX_API_KEY: string | undefined
  MINIMAX_MODEL: string
  MINIMAX_BASE_URL: string
} = {
  REPORT_PROVIDER: 'anthropic',
  ANTHROPIC_API_KEY: 'sk-test',
  ANTHROPIC_MODEL: 'claude-opus-4-8',
  MINIMAX_API_KEY: 'mm-test',
  MINIMAX_MODEL: 'MiniMax-M3',
  MINIMAX_BASE_URL: 'https://api.minimaxi.com/v1',
}
```
  2. 新增 openai mock(紧邻 anthropic mock):
```ts
const mmCreateMock = vi.fn()
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mmCreateMock } }
  },
}))
```
  3. 在 `describe('draftNarrative')` 的 `beforeEach` 里 reset 并复位 provider:
```ts
    mmCreateMock.mockReset()
    fakeEnv.REPORT_PROVIDER = 'anthropic'
    fakeEnv.MINIMAX_API_KEY = 'mm-test'
    fakeEnv.MINIMAX_MODEL = 'MiniMax-M3'
```
  4. 新增用例:
```ts
  it('minimax: 发送 system+user 两条消息并返回文本,model 为 MINIMAX_MODEL', async () => {
    fakeEnv.REPORT_PROVIDER = 'minimax'
    mmCreateMock.mockResolvedValue({ choices: [{ message: { content: '小明进步明显。' } }] })
    const { draftNarrative } = await import('@/lib/report-draft')
    const res = await draftNarrative(sampleData)

    expect(res.narrative).toBe('小明进步明显。')
    expect(res.model).toBe('MiniMax-M3')
    expect(res.rubricVersion).toBe(RUBRIC_VERSION)
    expect(createMock).not.toHaveBeenCalled() // 未走 Anthropic

    const arg = mmCreateMock.mock.calls[0]![0]
    expect(arg.model).toBe('MiniMax-M3')
    expect(arg.messages[0].role).toBe('system')
    expect(arg.messages[1].role).toBe('user')
    expect(arg.messages[1].content).toContain('小明')
  })

  it('minimax: 未配 MINIMAX_API_KEY 时抛错且不调用 API', async () => {
    fakeEnv.REPORT_PROVIDER = 'minimax'
    fakeEnv.MINIMAX_API_KEY = undefined
    const { draftNarrative } = await import('@/lib/report-draft')
    await expect(draftNarrative(sampleData)).rejects.toThrow('未配置 MiniMax API Key')
    expect(mmCreateMock).not.toHaveBeenCalled()
  })
```
- **MIRROR**: `TEST_STRUCTURE` + `TEST_CASE` 片段。
- **IMPORTS**: 无新增(`vi`/`expect`/`import()` 已在用)。
- **GOTCHA**:
  - 因用 `await import('@/lib/report-draft')` 动态导入,mock 必须在文件顶层 `vi.mock`,provider 靠 `fakeEnv` 运行时切换即可,无需重置模块。
  - 现有两条 Anthropic 用例需确保 `fakeEnv.REPORT_PROVIDER === 'anthropic'`(在 `beforeEach` 已复位),否则会误走 MiniMax。
- **VALIDATE**: `pnpm test` 全绿,新增 2 例通过,旧例不回归。

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| anthropic 组装+返回(既有) | provider=anthropic, mock 返回 text block | narrative 文本, model=claude-opus-4-8 | 否 |
| anthropic 未配 Key(既有) | ANTHROPIC_API_KEY=undefined | 抛 `未配置 Claude API Key`, 不调用 | 是 |
| minimax 组装+返回(新) | provider=minimax, mock 返回 choices | narrative 文本, model=MiniMax-M3, system+user 两条消息 | 否 |
| minimax 未配 Key(新) | provider=minimax, MINIMAX_API_KEY=undefined | 抛 `未配置 MiniMax API Key`, 不调用 | 是 |

### Edge Cases Checklist
- [x] 空/缺失 Key(两条 provider 各一例)
- [x] provider 选择错误路径隔离(断言另一 provider 的 mock 未被调用)
- [ ] MiniMax 返回空 content → `narrative` 为 `''`(由 `?? ''` 兜底,可选补一例)
- [ ] 网络失败 → SDK 抛错,经 actions 的 catch 以 data 回传(现有通道,无需新测)
- [ ] 无效类型 → env 层 zod 在启动时校验(`REPORT_PROVIDER` enum)

---

## Validation Commands

### Static Analysis
```bash
pnpm typecheck
```
EXPECT: 零类型错误

```bash
pnpm lint
```
EXPECT: 零 lint 错误

### Unit Tests
```bash
pnpm test
```
EXPECT: 全部通过,含新增 2 例 MiniMax 用例

### Full Build
```bash
pnpm build
```
EXPECT: 构建成功(`openai` 打包正常,server-only 约束不破)

### Manual Validation
- [ ] `.env` 设 `REPORT_PROVIDER=minimax` + 有效 `MINIMAX_API_KEY`,`pnpm dev` 后在 `/dashboard/reports` 点「生成草稿」,得到中文叙述且报告 `model` 显示 `MiniMax-M3`。
- [ ] 移除 `MINIMAX_API_KEY`,同操作时面板显示 `未配置 MiniMax API Key（MINIMAX_API_KEY），无法起草报告`(不是 React #441)。
- [ ] `REPORT_PROVIDER=anthropic`(或不设)时行为与改造前完全一致。

---

## Acceptance Criteria
- [ ] `REPORT_PROVIDER` 可在 anthropic / minimax 间切换,默认 anthropic 行为不变
- [ ] MiniMax 路径经 `openai` SDK + `MINIMAX_BASE_URL` 成功起草并返回中文叙述
- [ ] `DraftResult.model` 如实记录所用模型名
- [ ] 未配对应 provider 的 Key 时抛出清晰中文错误,经既有 as-data 通道回传
- [ ] 所有 validation 命令通过,新增测试通过、旧测试不回归

## Completion Checklist
- [ ] 代码遵循 t3-env/zod、server-only、provider 私有函数拆分等既有模式
- [ ] 错误处理沿用「抛中文 Error → actions catch 回传 data」约定
- [ ] 测试复刻既有 env+SDK mock 结构
- [ ] 无硬编码 Key;base URL / model 走 env 默认值
- [ ] `.env.example` 已更新且不含真实密钥
- [ ] 未新增范围外功能(无 UI 选择、无自动降级、无流式)
- [ ] 自洽 —— 实施期间无需再查代码库或提问

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| openai SDK 类型不接受 `max_completion_tokens` | 中 | 低 | 退回 `max_tokens: 2048`(MiniMax 兼容),Task 3 GOTCHA 已注明 |
| CN Key 配到 minimax.io(区域不匹配)→ 404 | 中 | 中 | `.env.example` 与 env 注释显著提示;默认 base URL 用 minimaxi.com |
| MiniMax 输出含 Markdown/寒暄,不符 rubric | 低 | 低 | rubric 已明确禁止;可后续按模型微调 prompt(范围外) |
| MiniMax 模型名迭代(M3 过期) | 低 | 低 | 模型名走 env `MINIMAX_MODEL`,改配置即可,无需改码 |
| openai 依赖体积/构建影响 | 低 | 低 | `pnpm build` 验证;仅在 server-only 模块引用 |

## Notes
- 用户决策(本次会话确认):**方案 = 可切换 Provider**、**集成方式 = 引入 openai SDK**。
- 关联上一次会话:用户因无 `ANTHROPIC_API_KEY` 无法起草报告;本改造提供国内可用的 MiniMax 替代路径,直接缓解该问题。
- `progressReport.model` 为自由字符串列,存 `MiniMax-M3` 无需迁移;历史报告不受影响。
- 未来可扩展:运行时/按报告的 provider 选择 UI、Claude→MiniMax 自动降级 —— 均已列入 NOT Building,另开需求。

Sources:
- [OpenAI SDK - MiniMax API Docs](https://platform.minimax.io/docs/api-reference/text-openai-api)
- [MiniMax API Key: Base URLs, Regions & Authentication](https://minimax-ai.chat/docs/minimax-api-key-base-url/)
- [MiniMax OpenAI-Compatible API: Node.js and Python](https://minimax-ai.chat/docs/openai-compatible-api/)
