import { describe, it, expect, vi, beforeEach } from 'vitest'

// Self-service "输入当前密码修改" (orch-change-feature). The Server Action is a thin wrapper over
// auth.api.changePassword (which verifies the current password against the live session). We unit-test
// the wrapper's contract: length is validated BEFORE auth is touched, a wrong current password maps to a
// Chinese message (not better-auth's opaque code), and success returns { ok: true }. The auth call and
// the request headers are mocked — the DB round-trip is covered by better-auth itself.

const { changePasswordMock } = vi.hoisted(() => ({ changePasswordMock: vi.fn() }))
vi.mock('@/auth/auth', () => ({ auth: { api: { changePassword: changePasswordMock } } }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/auth/context', () => ({
  requireAuthContext: async () => ({
    tenantId: 't',
    userId: 'u',
    role: 'parent',
    isPlatformAdmin: false,
  }),
}))

import { changeOwnPassword } from '@/auth/account-actions'

beforeEach(() => {
  changePasswordMock.mockReset()
})

describe('changeOwnPassword — self-service password change', () => {
  it('changes the password on success and revokes other sessions', async () => {
    changePasswordMock.mockResolvedValueOnce({ token: 'new' })
    const res = await changeOwnPassword({
      currentPassword: 'old-password-123',
      newPassword: 'new-password-456',
    })
    expect(res).toEqual({ ok: true })
    expect(changePasswordMock).toHaveBeenCalledTimes(1)
    const arg = changePasswordMock.mock.calls[0][0]
    expect(arg.body).toMatchObject({
      currentPassword: 'old-password-123',
      newPassword: 'new-password-456',
      revokeOtherSessions: true,
    })
    expect(arg.headers).toBeInstanceOf(Headers)
  })

  it('maps a wrong current password to a Chinese message', async () => {
    changePasswordMock.mockRejectedValueOnce({
      status: 'BAD_REQUEST',
      body: { code: 'INVALID_PASSWORD', message: 'Invalid password' },
    })
    const res = await changeOwnPassword({
      currentPassword: 'wrong-one-123',
      newPassword: 'new-password-456',
    })
    expect(res).toEqual({ ok: false, error: '当前密码不正确' })
  })

  it('rejects a too-short new password WITHOUT calling auth', async () => {
    const res = await changeOwnPassword({
      currentPassword: 'old-password-123',
      newPassword: 'short',
    })
    expect(res).toEqual({ ok: false, error: '密码至少 8 位' })
    expect(changePasswordMock).not.toHaveBeenCalled()
  })

  it('returns a safe generic error for any other failure', async () => {
    changePasswordMock.mockRejectedValueOnce(new Error('boom'))
    const res = await changeOwnPassword({
      currentPassword: 'old-password-123',
      newPassword: 'new-password-456',
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBeTruthy()
  })
})
