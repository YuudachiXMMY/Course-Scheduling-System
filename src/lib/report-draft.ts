import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { buildReportPrompt, RUBRIC_VERSION } from '@/lib/report-prompt'
import type { ReportData } from '@/lib/report-stats'
import { env } from '@/env'

// P5: single, stateless, no-tool Claude call that drafts the narrative. Not an agent / MCP /
// draft-and-confirm flow — the teacher review gate (draft → approved) lives in the DB/actions layer.
// Numbers are rendered from the DB in the PDF; the model only writes prose.

export interface DraftResult {
  narrative: string
  model: string
  rubricVersion: string
}

export async function draftNarrative(data: ReportData): Promise<DraftResult> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('未配置 Claude API Key（ANTHROPIC_API_KEY），无法起草报告')
  }
  const { system, userJson } = buildReportPrompt({ rubricVersion: RUBRIC_VERSION, data })
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

  return { narrative, model: env.ANTHROPIC_MODEL, rubricVersion: RUBRIC_VERSION }
}
