import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AuthError, type AuthContext } from '@/auth/context'
import { enrollment, student } from '@/db/schema'
import { authErrorResponse } from '@/app/api/_auth'

// EH3 / PERF1 — the authenticated report/export API routes used to let AuthError escape the handler
// (Next → HTTP 500 instead of 401/403), and export/section rendered one Chromium PNG per student with
// no cap. This suite pins: (1) the shared authErrorResponse mapper, and (2) the export/section route
// returning 401 (unauthenticated), 403 (forbidden), and 413 (roster over MAX_EXPORT_STUDENTS).

// Drive the REAL route handler as a chosen principal: override ONLY requireAuthContext (importActual
// keeps AuthError real so the mapper + the pure test below still work). Mock the data/render leaves so
// no DB, browser, or heavy render module is loaded — the 401/403/413 paths all return before the loop.
vi.mock('@/auth/context', async (importActual) => ({
  ...(await importActual<typeof import('@/auth/context')>()),
  requireAuthContext: vi.fn(),
}))
vi.mock('@/auth/authorize', () => ({ requirePermission: vi.fn() }))
vi.mock('@/auth/scope', () => ({
  actorOwnsSection: vi.fn(() => true),
  actorOwnsStudent: vi.fn(async () => true),
}))
vi.mock('@/db/tenant', () => ({ forTenant: vi.fn() }))
vi.mock('@/lib/browser', () => ({ renderCardPng: vi.fn() }))
vi.mock('@/app/dashboard/students/share-data', () => ({
  ensureActiveShare: vi.fn(),
  getStudentLessonsForTenant: vi.fn(),
}))
vi.mock('@/lib/schedule-card-render', () => ({ renderScheduleCardHtml: vi.fn() }))
vi.mock('@/lib/qr', () => ({ qrDataUrl: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { actorOwnsSection } from '@/auth/scope'
import { forTenant } from '@/db/tenant'
import { GET as exportSectionGET } from '@/app/api/export/section/[sectionId]/route'
import { provisionPortalAccount } from '@/app/dashboard/students/portal-actions'

const ctx: AuthContext = { userId: 'u1', tenantId: 't1', role: 'owner', isPlatformAdmin: false }
const req = () => new Request('http://localhost/api/export/section/sec1')
const paramsFor = (sectionId: string) => ({ params: Promise.resolve({ sectionId }) })

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) so a mockImplementation set in one test — e.g. requirePermission
  // throwing FORBIDDEN in the 403 case — can't leak into the next; each test sets the impls it needs.
  vi.resetAllMocks()
})

// ---------------------------------------------------------------------------
// Pure: authErrorResponse mapping (real AuthError).
// ---------------------------------------------------------------------------
describe('authErrorResponse (EH3 helper)', () => {
  it('maps UNAUTHENTICATED → 401', () => {
    expect(authErrorResponse(new AuthError('UNAUTHENTICATED'))?.status).toBe(401)
  })

  it.each(['FORBIDDEN', 'NO_ACTIVE_ORG', 'NOT_A_MEMBER'] as const)('maps %s → 403', (code) => {
    expect(authErrorResponse(new AuthError(code))?.status).toBe(403)
  })

  it('returns null for a non-AuthError so the caller re-throws (→ genuine 500)', () => {
    expect(authErrorResponse(new Error('db exploded'))).toBeNull()
    expect(authErrorResponse('nope')).toBeNull()
    expect(authErrorResponse(undefined)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Route: export/section returns 401 / 403 / 413 through the try/catch wiring.
// ---------------------------------------------------------------------------
describe('GET /api/export/section/[sectionId] (EH3 + PERF1)', () => {
  it('401 when unauthenticated (AuthError → not 500)', async () => {
    vi.mocked(requireAuthContext).mockRejectedValue(new AuthError('UNAUTHENTICATED'))
    const res = await exportSectionGET(req(), paramsFor('sec1'))
    expect(res.status).toBe(401)
  })

  it('403 when the permission gate denies (FORBIDDEN → not 500)', async () => {
    vi.mocked(requireAuthContext).mockResolvedValue(ctx)
    vi.mocked(requirePermission).mockImplementation(() => {
      throw new AuthError('FORBIDDEN')
    })
    const res = await exportSectionGET(req(), paramsFor('sec1'))
    expect(res.status).toBe(403)
  })

  it('413 when the roster exceeds MAX_EXPORT_STUDENTS', async () => {
    vi.mocked(requireAuthContext).mockResolvedValue(ctx)
    vi.mocked(actorOwnsSection).mockReturnValue(true)
    const enrollments = Array.from({ length: 61 }, (_, i) => ({
      studentId: `s${i}`,
      status: 'active',
    }))
    const students = Array.from({ length: 61 }, (_, i) => ({
      id: `s${i}`,
      name: `n${i}`,
      schoolGrade: null,
    }))
    vi.mocked(forTenant).mockReturnValue({
      findById: vi.fn().mockResolvedValue({ id: 'sec1', tenantId: 't1', teacherId: 'u1' }),
      select: vi.fn(async (table: unknown) =>
        table === enrollment ? enrollments : table === student ? students : [],
      ),
    } as unknown as ReturnType<typeof forTenant>)
    const res = await exportSectionGET(req(), paramsFor('sec1'))
    expect(res.status).toBe(413)
  })
})

// ---------------------------------------------------------------------------
// EH7: provisionPortalAccount surfaces the schema's Chinese per-field message on a Zod failure,
// never the raw JSON issue dump. safeParse rejects before the core, so no DB is touched.
// ---------------------------------------------------------------------------
describe('provisionPortalAccount validation (EH7)', () => {
  it('returns the Chinese field message for an invalid password (no zod issue dump)', async () => {
    vi.mocked(requireAuthContext).mockResolvedValue(ctx)
    const res = await provisionPortalAccount({
      studentId: 's1',
      name: '张三',
      kind: 'parent',
      password: '123', // < 8 chars → schema message '密码至少 8 位'
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toBe('密码至少 8 位')
      // Must NOT be the raw ZodError JSON dump (brackets/braces from the issues array).
      expect(res.error).not.toMatch(/[[\]{}]/)
    }
  })
})
