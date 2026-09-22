// When an insert/update slips past the app pre-check (race, or a code path that forgot to check),
// the GiST constraint raises SQLSTATE 23P01. Translate it into a domain error. (P2-3)
export class ConflictError extends Error {
  constructor(public detail = '时间冲突') {
    super('CONFLICT')
    this.name = 'ConflictError'
  }
}

// EH8/EH9 (CWE-209): a marker for a user-facing business-rule error whose Chinese message is SAFE to
// surface to the (possibly untrusted external) caller — e.g. '课节不存在', '该学生未在此班级',
// '无权访问该学生'. It is deliberately distinct from an *unexpected* internal error (a DB/postgres
// fault, a bug) whose raw message must NEVER reach a portal parent/student. Server Actions on the
// external boundary forward `e.message` ONLY when `e instanceof BusinessError`; AuthError/ConflictError
// are translated explicitly and everything else collapses to a generic '提交失败'-style fallback.
export class BusinessError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BusinessError'
  }
}

// EH8/EH9 (CWE-209): translate a caught error into a user-SAFE { ok:false, error } for an EXTERNAL
// portal Server Action reachable by untrusted parent/student accounts. Only messages we KNOW are
// user-facing are forwarded:
//   - BusinessError → its Chinese business message (safe by construction).
//   - ConflictError → the domain detail ('时间冲突').
//   - AuthError     → its code translated to a Chinese sentence (never the raw 'FORBIDDEN' code).
// Anything else (a DB/postgres fault, a bug) is logged server-side and collapsed to `fallback`, so no
// internal message ever leaks to the client. AuthError lives in @/auth/context; it is matched
// STRUCTURALLY (name + code) rather than by import to keep this leaf module free of an import cycle.
export function toPortalActionError(e: unknown, fallback: string): { ok: false; error: string } {
  if (e instanceof BusinessError) return { ok: false, error: e.message }
  if (e instanceof ConflictError) return { ok: false, error: e.detail || '时间冲突' }
  if (e instanceof Error && e.name === 'AuthError') {
    const code = (e as { code?: string }).code
    const map: Record<string, string> = {
      UNAUTHENTICATED: '请先登录',
      FORBIDDEN: '无权执行该操作',
      NO_ACTIVE_ORG: '无权执行该操作',
      NOT_A_MEMBER: '无权执行该操作',
    }
    return { ok: false, error: (code && map[code]) || '无权执行该操作' }
  }
  console.error('portal action failed', e)
  return { ok: false, error: fallback }
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

// Same cause-chain walk for the UNIQUE violation SQLSTATE 23505 — used to convert a lost
// select-then-write race (e.g. the quick-grade upsert backstopped by uq_grade_lesson_student_title)
// into an idempotent retry instead of surfacing a raw DB error. (F5)
export function isUniqueViolation(e: unknown): boolean {
  let cur = e
  for (let depth = 0; depth < 5 && typeof cur === 'object' && cur !== null; depth++) {
    if ((cur as { code?: string }).code === '23505') return true
    cur = (cur as { cause?: unknown }).cause
  }
  return false
}
