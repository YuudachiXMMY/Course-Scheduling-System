import { describe, it, expect } from 'vitest'
import { BusinessError, ConflictError, toPortalActionError } from '@/lib/errors'

// EH8/EH9 (CWE-209): the portal Server-Action error mapper must forward ONLY user-safe messages and
// collapse any unexpected internal error to a generic fallback (no info leak to untrusted portal users).
describe('toPortalActionError — 门户动作错误脱敏 (EH8/EH9)', () => {
  it('业务错误 → 转发其中文文本', () => {
    expect(toPortalActionError(new BusinessError('课节不存在'), '提交失败')).toEqual({
      ok: false,
      error: '课节不存在',
    })
    expect(toPortalActionError(new BusinessError('该学生未在此班级'), '提交失败')).toEqual({
      ok: false,
      error: '该学生未在此班级',
    })
  })

  it('ConflictError → 翻译为“时间冲突”', () => {
    expect(toPortalActionError(new ConflictError(), '提交失败')).toEqual({
      ok: false,
      error: '时间冲突',
    })
  })

  it('AuthError → 翻译为中文（绝不暴露原始 code）', () => {
    // AuthError is matched structurally (name + code) — mirror its runtime shape.
    const forbidden = Object.assign(new Error('FORBIDDEN'), {
      name: 'AuthError',
      code: 'FORBIDDEN',
    })
    const res = toPortalActionError(forbidden, '提交失败')
    expect(res).toEqual({ ok: false, error: '无权执行该操作' })
    expect(res.error).not.toBe('FORBIDDEN') // raw code must never surface

    const unauth = Object.assign(new Error('UNAUTHENTICATED'), {
      name: 'AuthError',
      code: 'UNAUTHENTICATED',
    })
    expect(toPortalActionError(unauth, '提交失败')).toEqual({ ok: false, error: '请先登录' })
  })

  it('未预期的内部错误 → 通用兜底消息，绝不泄露原始 message', () => {
    const internal = new Error(
      'connect ECONNREFUSED 10.0.0.5:5432 — column "secret" does not exist',
    )
    const res = toPortalActionError(internal, '提交失败')
    expect(res).toEqual({ ok: false, error: '提交失败' })
    expect(res.error).not.toContain('ECONNREFUSED')
    expect(res.error).not.toContain('10.0.0.5')
  })

  it('兜底消息按调用方给定（提交失败 / 取消失败 / 操作失败）', () => {
    expect(toPortalActionError('a raw string thrown', '取消失败')).toEqual({
      ok: false,
      error: '取消失败',
    })
    expect(toPortalActionError(null, '操作失败')).toEqual({ ok: false, error: '操作失败' })
  })
})
