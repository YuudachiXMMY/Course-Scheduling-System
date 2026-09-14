// P5: PURE report types + aggregators — NO db / no server-only imports, so they are directly
// unit-testable (mirrors why composeParentMessage lives outside the DB layer). Numbers are
// computed here from raw rows; Claude never touches them.

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused'

export interface AttendanceSummary {
  total: number
  present: number
  absent: number
  late: number
  excused: number
  rate: number // present / total, 0..1 (0 when total=0), 2-decimal
}

export interface GradeItem {
  title: string | null
  score: number | null
  maxScore: number | null
  comment: string | null
}

export interface ReportData {
  studentName: string
  schoolGrade: string | null
  periodStart: string | null // ISO yyyy-mm-dd
  periodEnd: string | null
  attendance: AttendanceSummary
  grades: GradeItem[]
  gradeAverage: number | null // avg of present scores, 1-decimal; null when none
  notes: string[] // note bodies for the AI to summarize (NOT numbers)
}

export function summarizeAttendance(statuses: AttendanceStatus[]): AttendanceSummary {
  const s: AttendanceSummary = { total: statuses.length, present: 0, absent: 0, late: 0, excused: 0, rate: 0 }
  for (const st of statuses) s[st] += 1
  s.rate = s.total === 0 ? 0 : Math.round((s.present / s.total) * 100) / 100
  return s
}

// grade.score comes back from node-pg as a STRING (numeric column). Parse before averaging.
export function parseScore(raw: string | null): number | null {
  if (raw == null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function averageScore(scores: (number | null)[]): number | null {
  const present = scores.filter((n): n is number => n != null)
  if (present.length === 0) return null
  return Math.round((present.reduce((a, b) => a + b, 0) / present.length) * 10) / 10
}
