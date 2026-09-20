import { describe, it, expect } from 'vitest'
import {
  buildReportPrompt,
  redactStudentData,
  REDACTED_STUDENT_PLACEHOLDER,
  RUBRIC_VERSION,
} from '@/lib/report-prompt'
import type { ReportData } from '@/lib/report-stats'

// H3 (PIPEDA cross-border minimization): the student's real name must NOT cross the border in the LLM
// prompt. redactStudentData is a pure function applied ONLY at the prompt boundary — getReportData /
// the PDF still carry the real name. These tests pin that contract.

const NAME = '张三丰'

function fixture(overrides: Partial<ReportData> = {}): ReportData {
  return {
    studentName: NAME,
    schoolGrade: '八年级',
    periodStart: '2026-01-01',
    periodEnd: '2026-03-31',
    attendance: { total: 10, present: 9, absent: 1, late: 0, excused: 0, rate: 0.9 },
    grades: [{ title: '期中', score: 88, maxScore: 100, comment: `${NAME}进步明显` }],
    gradeAverage: 88,
    notes: [`本月${NAME}课堂参与积极`, '无其他备注'],
    ...overrides,
  }
}

describe('redactStudentData', () => {
  it('replaces the name field with the neutral placeholder', () => {
    const out = redactStudentData(fixture())
    expect(out.studentName).toBe(REDACTED_STUDENT_PLACEHOLDER)
    expect(out.studentName).not.toContain(NAME)
  })

  it('scrubs the exact registered name out of grade comments and notes', () => {
    const out = redactStudentData(fixture())
    expect(out.grades[0].comment).toBe(`${REDACTED_STUDENT_PLACEHOLDER}进步明显`)
    expect(out.notes[0]).toBe(`本月${REDACTED_STUDENT_PLACEHOLDER}课堂参与积极`)
    for (const n of out.notes) expect(n).not.toContain(NAME)
    expect(out.grades[0].comment).not.toContain(NAME)
  })

  it('does not mutate the input (getReportData / PDF still see the real name)', () => {
    const input = fixture()
    redactStudentData(input)
    expect(input.studentName).toBe(NAME)
    expect(input.notes[0]).toContain(NAME)
    expect(input.grades[0].comment).toContain(NAME)
  })

  it('preserves non-name fields and null comments', () => {
    const out = redactStudentData(
      fixture({ grades: [{ title: 't', score: null, maxScore: null, comment: null }] }),
    )
    expect(out.schoolGrade).toBe('八年级')
    expect(out.attendance.rate).toBe(0.9)
    expect(out.grades[0].comment).toBeNull()
  })

  it('leaves free text unchanged for a 1-char name (avoids mangling common characters)', () => {
    const out = redactStudentData(
      fixture({ studentName: '李', notes: ['季度里表现稳定'], grades: [] }),
    )
    // The single char 李 must NOT be stripped from unrelated words like "季度".
    expect(out.notes[0]).toBe('季度里表现稳定')
    expect(out.studentName).toBe(REDACTED_STUDENT_PLACEHOLDER)
  })
})

describe('buildReportPrompt', () => {
  it('emits the redacted name into the <STUDENT_DATA> block, never the real name', () => {
    const { userJson } = buildReportPrompt({ rubricVersion: RUBRIC_VERSION, data: fixture() })
    expect(userJson).toContain(REDACTED_STUDENT_PLACEHOLDER)
    expect(userJson).not.toContain(NAME)
  })
})
