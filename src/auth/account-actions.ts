'use server'

import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/auth/auth'
import { requireAuthContext } from '@/auth/context'

// Self-service "输入当前密码修改" Server Action, shared by /dashboard/account (staff) and /portal/account
// (parent/student). Thin wrapper over auth.api.changePassword, which verifies currentPassword against the
// caller's live session before rotating the hash. Business results are returned as DATA (not thrown) so the
// Chinese messages survive Next.js's production redaction of thrown Server-Action errors (React #441) —
// mirrors user-actions.ts / staff-actions.ts.
export type ChangePasswordResult = { ok: true } | { ok: false; error: string }

const changeSchema = z.object({
  currentPassword: z.string().min(1, '请输入当前密码'),
  newPassword: z.string().min(8, '密码至少 8 位'),
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
  await requireAuthContext()
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
