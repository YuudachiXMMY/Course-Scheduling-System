import { describe, it, expect } from 'vitest'
import { ConflictError, isExclusionViolation, toPortalActionError } from '@/lib/errors'

// errors.ts is a pure leaf module. portal-action-error.test.ts already covers the common
// toPortalActionError paths (BusinessError / ConflictError-default / FORBIDDEN / UNAUTHENTICATED /
// internal fallback). This file closes the remaining branches: the full isExclusionViolation
// cause-chain walk and the AuthError codes / ConflictError-detail branches not exercised there.

// SQLSTATE 23P01 is the GiST exclusion violation. Drizzle 0.45 wraps postgres.js's PostgresError in a
// DrizzleQueryError, so the code can sit several `.cause` hops down — the walk is depth-limited to 5.
describe('isExclusionViolation — cause-chain walk (SQLSTATE 23P01)', () => {
  it('matches a top-level code', () => {
    expect(isExclusionViolation({ code: '23P01' })).toBe(true)
  })

  it('matches a code nested one .cause hop down (the Drizzle wrapping case)', () => {
    expect(isExclusionViolation({ cause: { code: '23P01' } })).toBe(true)
  })

  it('matches a code up to four .cause hops down (within the depth-5 budget)', () => {
    const nested = { cause: { cause: { cause: { cause: { code: '23P01' } } } } }
    expect(isExclusionViolation(nested)).toBe(true)
  })

  it('does NOT match a code buried beyond the depth-5 cutoff', () => {
    // Depths 0..4 are inspected (5 iterations); a code first appearing at depth 5 is never reached.
    const tooDeep = { cause: { cause: { cause: { cause: { cause: { code: '23P01' } } } } } }
    expect(isExclusionViolation(tooDeep)).toBe(false)
  })

  it('returns false for a different SQLSTATE', () => {
    expect(isExclusionViolation({ code: '23505', cause: { code: '23503' } })).toBe(false)
  })

  it('returns false for an object with neither code nor cause', () => {
    expect(isExclusionViolation({})).toBe(false)
  })

  it('returns false for null, undefined, and non-object inputs', () => {
    expect(isExclusionViolation(null)).toBe(false)
    expect(isExclusionViolation(undefined)).toBe(false)
    expect(isExclusionViolation('23P01')).toBe(false)
    expect(isExclusionViolation(42)).toBe(false)
  })
})

// Structural AuthError shape (matched by name + code, never imported — see errors.ts import-cycle note).
const authError = (code?: string) =>
  Object.assign(new Error(code ?? 'AUTH'), { name: 'AuthError', code })

describe('toPortalActionError — remaining AuthError / ConflictError branches', () => {
  it('maps NO_ACTIVE_ORG and NOT_A_MEMBER to the generic authorization sentence', () => {
    expect(toPortalActionError(authError('NO_ACTIVE_ORG'), '提交失败').error).toBe('无权执行该操作')
    expect(toPortalActionError(authError('NOT_A_MEMBER'), '提交失败').error).toBe('无权执行该操作')
  })

  it('falls back to the generic sentence for an unknown AuthError code', () => {
    const res = toPortalActionError(authError('SOME_NEW_CODE'), '提交失败')
    expect(res).toEqual({ ok: false, error: '无权执行该操作' })
    expect(res.error).not.toContain('SOME_NEW_CODE') // raw code never surfaces
  })

  it('falls back to the generic sentence for an AuthError with no code', () => {
    expect(toPortalActionError(authError(undefined), '提交失败')).toEqual({
      ok: false,
      error: '无权执行该操作',
    })
  })

  it('forwards a ConflictError custom detail verbatim', () => {
    expect(toPortalActionError(new ConflictError('教师时间冲突'), '提交失败')).toEqual({
      ok: false,
      error: '教师时间冲突',
    })
  })

  it('falls back to 时间冲突 when a ConflictError detail is empty', () => {
    expect(toPortalActionError(new ConflictError(''), '提交失败')).toEqual({
      ok: false,
      error: '时间冲突',
    })
  })
})
