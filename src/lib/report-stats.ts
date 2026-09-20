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
  const s: AttendanceSummary = {
    total: statuses.length,
    present: 0,
    absent: 0,
    late: 0,
    excused: 0,
    rate: 0,
  }
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

// Bound the note text that flows into the LLM prompt. Shared notes can be arbitrarily long Markdown/
// LaTeX, so even a capped COUNT of notes can balloon a single draft to hundreds of KB — inflating token
// cost and latency, and (with H4's timeout) risking a slow/failed draft. Cap each note and the running
// total, preserving order (callers pass most-recent-first). Pure + client-safe so it stays unit-testable.
export function capNotesForPrompt(
  bodies: string[],
  opts: { maxTotalChars?: number; maxPerNote?: number } = {},
): string[] {
  const maxTotal = opts.maxTotalChars ?? 20_000
  const maxPer = opts.maxPerNote ?? 4_000
  const out: string[] = []
  let used = 0
  for (const raw of bodies) {
    if (used >= maxTotal) break
    const perCap = Math.min(maxPer, maxTotal - used)
    const body = raw.length > perCap ? raw.slice(0, perCap) : raw
    out.push(body)
    used += body.length
  }
  return out
}
