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
