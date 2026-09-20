import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { buildReportPrompt, RUBRIC_VERSION } from '@/lib/report-prompt'
import { sanitizeNarrative, validateNarrative } from '@/lib/report-sanitize'
import type { ReportData } from '@/lib/report-stats'
import { env } from '@/env'

// P5/P8: 单次、无状态、无工具的 LLM 调用,起草报告叙述。teacher 审核门(draft → approved)在
// DB/actions 层;数字由 DB 渲染进 PDF,模型只写正文。P8 起支持按 REPORT_PROVIDER 切换 provider。

export interface DraftResult {
  narrative: string
  model: string
  rubricVersion: string
}

// H4: bound how long a report draft can block. Both SDKs default to a 10-minute timeout with 2 retries
// (~30 min worst case), and this call runs synchronously inside a teacher's Server Action — a hung or
// slow provider would pin request-handling capacity and can cascade into a site-wide stall. Cap each
// attempt at 2 minutes and allow a single retry (≈4 min worst case) so a stuck provider fails fast.
const LLM_TIMEOUT_MS = 120_000
const LLM_MAX_RETRIES = 1

export async function draftNarrative(data: ReportData): Promise<DraftResult> {
  const { system, userJson } = buildReportPrompt({ rubricVersion: RUBRIC_VERSION, data })
  const { narrative: raw, model } =
    env.REPORT_PROVIDER === 'minimax'
      ? await draftWithMiniMax(system, userJson)
      : await draftWithAnthropic(system, userJson)
  // P9: 出口侧统一清洗——无论哪个 provider，都在此单一出口剥掉 LLM 夹带的杂鱼（会话式前后缀、
  // Markdown 残留、代码围栏、多余空行），再对空/拒答兜底抛错，避免把垃圾/空草稿静默落库。数字仍由
  // DB 渲染进 PDF，模型碰不到，因此清洗只作用于叙述文字。
  const narrative = sanitizeNarrative(raw)
  validateNarrative(narrative)
  return { narrative, model, rubricVersion: RUBRIC_VERSION }
}

async function draftWithAnthropic(
  system: string,
  userJson: string,
): Promise<{ narrative: string; model: string }> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('未配置 Claude API Key（ANTHROPIC_API_KEY），无法起草报告')
  }
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    timeout: LLM_TIMEOUT_MS,
    maxRetries: LLM_MAX_RETRIES,
  })
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
  const client = new OpenAI({
    apiKey: env.MINIMAX_API_KEY,
    baseURL: env.MINIMAX_BASE_URL,
    timeout: LLM_TIMEOUT_MS,
    maxRetries: LLM_MAX_RETRIES,
  })
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
