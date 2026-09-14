import { describe, it, expect, vi, beforeEach } from 'vitest'
import { summarizeAttendance, parseScore, averageScore, type ReportData } from '@/lib/report-stats'
import { buildReportPrompt, RUBRIC, RUBRIC_VERSION } from '@/lib/report-prompt'
import { can } from '@/auth/authorize'
import { renderReportPdf } from '@/lib/report-pdf'

// ---- Mocks for the Claude-draft path (env + SDK), so no real API is hit ----
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

const sampleData: ReportData = {
  studentName: '小明',
  schoolGrade: '初二',
  periodStart: '2026-03-01',
  periodEnd: '2026-03-31',
  attendance: { total: 5, present: 4, absent: 1, late: 0, excused: 0, rate: 0.8 },
  grades: [{ title: '月考', score: 85, maxScore: 100, comment: '进步明显' }],
  gradeAverage: 85,
  notes: ['课堂专注', '作业按时完成'],
}

// ---------------------------------------------------------------------------
// PURE: attendance / grade aggregators
// ---------------------------------------------------------------------------
describe('report-stats aggregators', () => {
  it('summarizeAttendance counts and computes rate', () => {
    const s = summarizeAttendance(['present', 'present', 'present', 'present', 'absent'])
    expect(s).toEqual({ total: 5, present: 4, absent: 1, late: 0, excused: 0, rate: 0.8 })
  })
  it('summarizeAttendance handles empty (rate 0, no divide-by-zero)', () => {
    expect(summarizeAttendance([])).toEqual({
      total: 0,
      present: 0,
      absent: 0,
      late: 0,
      excused: 0,
      rate: 0,
    })
  })
  it('parseScore parses numeric STRINGS from node-pg (and rejects junk)', () => {
    expect(parseScore('85.00')).toBe(85)
    expect(parseScore(null)).toBeNull()
    expect(parseScore('not-a-number')).toBeNull()
  })
  it('averageScore averages present scores, ignoring nulls', () => {
    expect(averageScore([85, 90])).toBe(87.5)
    expect(averageScore([85, null, 90])).toBe(87.5)
    expect(averageScore([null, null])).toBeNull()
    expect(averageScore([])).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// PURE: prompt composer (anti-hallucination rubric + data in user turn)
// ---------------------------------------------------------------------------
describe('buildReportPrompt', () => {
  it('system rubric forbids fabricating facts', () => {
    const { system } = buildReportPrompt({ rubricVersion: RUBRIC_VERSION, data: sampleData })
    expect(system).toBe(RUBRIC.v1)
    expect(system).toContain('绝不得编造')
    expect(system).toContain('数据库渲染')
  })
  it('userJson carries the structured data (numbers) for the model to summarize', () => {
    const { userJson } = buildReportPrompt({ rubricVersion: RUBRIC_VERSION, data: sampleData })
    expect(userJson).toContain('小明')
    expect(userJson).toContain('"rate": 0.8')
    expect(userJson).toContain('月考')
  })
  it('falls back to the default rubric for an unknown version', () => {
    const { system } = buildReportPrompt({ rubricVersion: 'nope', data: sampleData })
    expect(system).toBe(RUBRIC.v1)
  })
})

// ---------------------------------------------------------------------------
// PURE: report RBAC matrix (can) — mirrors rbac-scheduling.test.ts
// ---------------------------------------------------------------------------
describe('report RBAC (can)', () => {
  it('owner/teacher can create + approve reports', () => {
    for (const role of ['owner', 'teacher']) {
      expect(can(role, { report: ['create'] })).toBe(true)
      expect(can(role, { report: ['approve'] })).toBe(true)
    }
  })
  it('assistant can read/list but NOT approve', () => {
    expect(can('assistant', { report: ['read'] })).toBe(true)
    expect(can('assistant', { report: ['list'] })).toBe(true)
    expect(can('assistant', { report: ['approve'] })).toBe(false)
    expect(can('assistant', { report: ['create'] })).toBe(false)
  })
  it('parent/student have no report access (MVP)', () => {
    expect(can('parent', { report: ['read'] })).toBe(false)
    expect(can('student', { report: ['read'] })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// PDF smoke: real @react-pdf render with the vendored Noto Sans SC .ttf.
// Proves the font loads AND Chinese renders (throws if fontkit rejects it).
// ---------------------------------------------------------------------------
describe('renderReportPdf', () => {
  it('renders a valid PDF buffer with an embedded font (CJK, no 豆腐)', async () => {
    const buf = await renderReportPdf({
      studentName: '小明',
      schoolGrade: '初二',
      periodStart: '2026-03-01',
      periodEnd: '2026-03-31',
      title: null,
      status: 'draft',
      narrative: '小明本月表现稳定，出勤良好。\n课堂参与积极，值得表扬。',
      attendance: sampleData.attendance,
      grades: sampleData.grades,
      gradeAverage: 85,
      generatedAt: '2026-04-01 10:00',
    })
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    // An embedded font subset makes even a 1-page CJK PDF sizable.
    expect(buf.length).toBeGreaterThan(3000)
  }, 20_000)
})

// ---------------------------------------------------------------------------
// Claude draft (mocked SDK + env) — no real API call
// ---------------------------------------------------------------------------
describe('draftNarrative', () => {
  beforeEach(() => {
    createMock.mockReset()
    fakeEnv.ANTHROPIC_API_KEY = 'sk-test'
    fakeEnv.ANTHROPIC_MODEL = 'claude-opus-4-8'
  })

  it('composes the request (cached rubric system, data in user turn) and returns the text', async () => {
    createMock.mockResolvedValue({ content: [{ type: 'text', text: '小明表现稳定。' }] })
    const { draftNarrative } = await import('@/lib/report-draft')
    const res = await draftNarrative(sampleData)

    expect(res.narrative).toBe('小明表现稳定。')
    expect(res.model).toBe('claude-opus-4-8')
    expect(res.rubricVersion).toBe(RUBRIC_VERSION)

    const arg = createMock.mock.calls[0]![0]
    expect(arg.model).toBe('claude-opus-4-8')
    expect(arg.system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(arg.messages[0].role).toBe('user')
    // Never send Opus-4.8-rejected sampling params.
    expect(arg.temperature).toBeUndefined()
    expect(arg.top_p).toBeUndefined()
  })

  it('throws (does not call the API) when ANTHROPIC_API_KEY is unset', async () => {
    fakeEnv.ANTHROPIC_API_KEY = undefined
    const { draftNarrative } = await import('@/lib/report-draft')
    await expect(draftNarrative(sampleData)).rejects.toThrow('未配置 Claude API Key')
    expect(createMock).not.toHaveBeenCalled()
  })
})
