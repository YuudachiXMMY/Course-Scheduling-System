'use server'

import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/auth/auth'
import { requireAuthContext } from '@/auth/context'
import { consumeRateLimit, resetRateLimit } from '@/lib/rate-limit'
import { MIN_PASSWORD_LENGTH, PASSWORD_MIN_MESSAGE } from '@/auth/password-policy'

// Throttle self-service password changes per user. The current-password check exists to stop a
// hijacked/short-lived session from being turned into permanent takeover; without a limit an attacker
// holding a valid session could script unlimited currentPassword guesses through this action (it does not
// go through better-auth's HTTP rate-limit middleware). 5 attempts / 15 min is far above any legitimate
// use (a person changes their own password rarely) yet makes online guessing impractical.
const CHANGE_PW_LIMIT = { limit: 5, windowMs: 15 * 60_000 }

// Self-service "输入当前密码修改" Server Action, shared by /dashboard/account (staff) and /portal/account
// (parent/student). Thin wrapper over auth.api.changePassword, which verifies currentPassword against the
// caller's live session before rotating the hash. Business results are returned as DATA (not thrown) so the
// Chinese messages survive Next.js's production redaction of thrown Server-Action errors (React #441) —
// mirrors user-actions.ts / staff-actions.ts.
export type ChangePasswordResult = { ok: true } | { ok: false; error: string }

const changeSchema = z.object({
  currentPassword: z.string().min(1, '请输入当前密码'),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH, PASSWORD_MIN_MESSAGE),
})
export type ChangeOwnPasswordInput = z.input<typeof changeSchema>

export async function changeOwnPassword(
  input: ChangeOwnPasswordInput,
): Promise<ChangePasswordResult> {
  // Validate at the boundary FIRST so a too-short password returns the Chinese field message without ever
  // hitting auth (the test asserts auth is untouched in that case).
  const parsed = changeSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '输入有误' }
  }
  // Must be a logged-in principal — changePassword needs the session cookie on the request headers.
  const ctx = await requireAuthContext()
  // Throttle per user AFTER auth (so a rejected attempt is tied to a real principal, and the too-short
  // case above never consumes a slot). A blocked caller is turned away before the currentPassword is ever
  // checked, capping how fast the secret can be guessed.
  const gate = consumeRateLimit(`change-pw:${ctx.userId}`, CHANGE_PW_LIMIT)
  if (!gate.allowed) {
    return { ok: false, error: `尝试过于频繁，请 ${Math.ceil(gate.retryAfterMs / 1000)} 秒后再试` }
  }
  try {
    await auth.api.changePassword({
      body: {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        // Rotate every other session on a password change — a self-service change should log out any other
        // device that may have known the old password.
        revokeOtherSessions: true,
      },
      headers: await headers(),
    })
    // Legitimate success clears the counter so a user who mistyped a couple of times then got it right is
    // not left throttled.
    resetRateLimit(`change-pw:${ctx.userId}`)
    return { ok: true }
  } catch (e) {
    console.error('changeOwnPassword failed', e)
    // Better Auth throws an APIError with body.code === 'INVALID_PASSWORD' when the current password is
    // wrong. Map it to a Chinese message instead of leaking the opaque code. Read defensively (the shape is
    // { status, body: { code, message } }) so a mock or a future shape change never throws here.
    const code = (e as { body?: { code?: string } })?.body?.code
    if (code === 'INVALID_PASSWORD') return { ok: false, error: '当前密码不正确' }
    return { ok: false, error: '修改密码失败，请稍后重试' }
  }
}
