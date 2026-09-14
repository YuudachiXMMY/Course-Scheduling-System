import type { ReportData } from '@/lib/report-stats'

// P5: PURE composer (no DB, no server-only) so it is directly unit-testable — mirrors
// composeParentMessage. Builds the (cacheable, versioned) rubric system prompt and the per-student
// user turn. The numbers are handed to Claude ONLY as context to summarize; the PDF renders them
// from the DB independently, so the model can never change a fact.

export const RUBRIC_VERSION = 'v1'

// Versioned so a rubric change bumps the version (report reproducibility + prompt-cache correctness).
export const RUBRIC: Record<string, string> = {
  v1: [
    '你是一位中文课程进度报告的写作助手，为独立教师起草面向家长的学生进度叙述。',
    '严格规则：',
    '1. 你只能根据用户提供的结构化数据（出勤统计、成绩、课堂笔记）来写作。',
    '2. 绝不得编造或推断任何未提供的事实——不得杜撰出勤率、成绩、分数、日期或事件。',
    '3. 出勤率与成绩等数字由系统另行从数据库渲染进 PDF；你只写叙述性文字，正文中不要重复罗列精确数字（可作定性描述，如“出勤稳定”）。',
    '4. 语气专业、鼓励、具体；面向家长，用简体中文。',
    '5. 输出 2–4 段纯文本叙述，不要 Markdown 标题、不要列表、不要前后缀寒暄（如“以下是……”）。',
    '6. 若某类数据为空，如实以中性措辞略过，不要编造。',
  ].join('\n'),
}

export interface ReportPrompt {
  system: string
  userJson: string
}

export function buildReportPrompt(args: { rubricVersion: string; data: ReportData }): ReportPrompt {
  const system = RUBRIC[args.rubricVersion] ?? RUBRIC[RUBRIC_VERSION]
  // The whole structured payload goes in the user turn (volatile → after the cached rubric prefix).
  const userJson = JSON.stringify(
    {
      instruction: '请依据以下结构化数据为该学生起草一份进度报告叙述。只写叙述，不要编造任何数字或事实。',
      data: args.data,
    },
    null,
    2,
  )
  return { system, userJson }
}
