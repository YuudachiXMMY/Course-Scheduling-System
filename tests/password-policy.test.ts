import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { MIN_PASSWORD_LENGTH, PASSWORD_MIN_MESSAGE } from '@/auth/password-policy'

// L-auth: the shared password floor. Every credential entry point (staff/portal provisioning,
// self-service change, admin reset, Better Auth) references MIN_PASSWORD_LENGTH, so pinning it here
// pins the policy across all of them.
describe('password policy', () => {
  it('sets the shared floor to at least 12', () => {
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThanOrEqual(12)
    expect(PASSWORD_MIN_MESSAGE).toContain(String(MIN_PASSWORD_LENGTH))
  })

  it('rejects passwords below the floor and accepts at/above it (the rule every schema applies)', () => {
    const schema = z.string().min(MIN_PASSWORD_LENGTH, PASSWORD_MIN_MESSAGE)
    expect(schema.safeParse('a'.repeat(MIN_PASSWORD_LENGTH - 1)).success).toBe(false)
    expect(schema.safeParse('a'.repeat(MIN_PASSWORD_LENGTH)).success).toBe(true)
    expect(schema.safeParse('a'.repeat(MIN_PASSWORD_LENGTH + 4)).success).toBe(true)
  })
})
