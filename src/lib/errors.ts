// When an insert/update slips past the app pre-check (race, or a code path that forgot to check),
// the GiST constraint raises SQLSTATE 23P01. Translate it into a domain error. (P2-3)
export class ConflictError extends Error {
  constructor(public detail = '时间冲突') {
    super('CONFLICT')
    this.name = 'ConflictError'
  }
}

// Drizzle 0.45 wraps the postgres.js PostgresError in a DrizzleQueryError, so the SQLSTATE lives on
// `.cause`. Walk the cause chain to find code 23P01 (the GiST exclusion violation).
export function isExclusionViolation(e: unknown): boolean {
  let cur = e
  for (let depth = 0; depth < 5 && typeof cur === 'object' && cur !== null; depth++) {
    if ((cur as { code?: string }).code === '23P01') return true
    cur = (cur as { cause?: unknown }).cause
  }
  return false
}
