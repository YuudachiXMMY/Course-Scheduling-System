import { describe, it, expect, vi, beforeEach } from 'vitest'

// H9: requirePagePermission must interrupt with notFound() (not throw AuthError) for a principal lacking
// a page's permission, so page renders never hit the looping generic error boundary. Mock next/navigation
// with a NON-throwing spy so we can assert on whether notFound was called without a framework interrupt
// propagating. vi.hoisted so the spy exists when the hoisted vi.mock factory runs.
const { notFound } = vi.hoisted(() => ({ notFound: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound }))

import {
  requirePagePermission,
  requirePermission,
  can,
  type PermissionRequest,
} from '@/auth/authorize'
import { AuthError, type AuthContext } from '@/auth/context'

function ctx(role: string, isPlatformAdmin = false): AuthContext {
  return { userId: 'u1', tenantId: 'org1', role, isPlatformAdmin }
}

const PERM: PermissionRequest = { lesson: ['list'] }

beforeEach(() => notFound.mockClear())

describe('requirePagePermission', () => {
  it('calls notFound() when the role lacks the permission (not throw AuthError)', () => {
    expect(can('', PERM)).toBe(false)
    requirePagePermission(ctx(''), PERM)
    expect(notFound).toHaveBeenCalledTimes(1)
  })

  it('bypasses for a platform admin without calling notFound()', () => {
    requirePagePermission(ctx('', true), PERM)
    expect(notFound).not.toHaveBeenCalled()
  })

  it('is a no-op for a role that holds the permission', () => {
    // owner is the top org role and holds lesson:list in the matrix; assert the precondition, then the guard.
    expect(can('owner', PERM)).toBe(true)
    requirePagePermission(ctx('owner'), PERM)
    expect(notFound).not.toHaveBeenCalled()
  })
})

describe('requirePermission (unchanged: still throws for Server Actions / data loaders)', () => {
  it('throws AuthError FORBIDDEN when the role lacks the permission — and never calls notFound', () => {
    expect(() => requirePermission(ctx(''), PERM)).toThrow(AuthError)
    expect(notFound).not.toHaveBeenCalled()
  })
})
