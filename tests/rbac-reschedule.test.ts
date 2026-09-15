import { describe, it, expect } from 'vitest'
import { can } from '@/auth/authorize'
import { isPortalRole } from '@/auth/portal'

// Phase 7a — the rescheduleRequest RBAC matrix is already declared in permissions.ts; this locks it.
describe('RBAC for reschedule requests', () => {
  it('parent/student can create + cancel their own, but NOT approve/reject or edit lessons', () => {
    for (const r of ['parent', 'student']) {
      expect(can(r, { rescheduleRequest: ['create'] })).toBe(true)
      expect(can(r, { rescheduleRequest: ['cancel'] })).toBe(true)
      expect(can(r, { rescheduleRequest: ['approve'] })).toBe(false)
      expect(can(r, { rescheduleRequest: ['reject'] })).toBe(false)
      expect(can(r, { lesson: ['update'] })).toBe(false)
      expect(can(r, { lesson: ['create'] })).toBe(false)
    }
  })

  it('teacher/admin/owner can approve + reject', () => {
    for (const r of ['teacher', 'admin', 'owner']) {
      expect(can(r, { rescheduleRequest: ['approve'] })).toBe(true)
      expect(can(r, { rescheduleRequest: ['reject'] })).toBe(true)
    }
  })

  it('owner/admin can create members (provision portal logins); parent/student cannot', () => {
    expect(can('owner', { member: ['create'] })).toBe(true)
    expect(can('admin', { member: ['create'] })).toBe(true)
    expect(can('parent', { member: ['create'] })).toBe(false)
    expect(can('student', { member: ['create'] })).toBe(false)
  })

  it('isPortalRole identifies parent/student (incl. comma-joined multi-role), not staff', () => {
    expect(isPortalRole('parent')).toBe(true)
    expect(isPortalRole('student')).toBe(true)
    expect(isPortalRole('parent,student')).toBe(true)
    expect(isPortalRole('owner')).toBe(false)
    expect(isPortalRole('teacher')).toBe(false)
    expect(isPortalRole('assistant')).toBe(false)
  })

  // Regression (PR #20 review C1): parent/student legitimately hold rescheduleRequest:['list'] for
  // their OWN /portal/reschedule view — so a page-level `requirePermission(rescheduleRequest:['list'])`
  // is NOT sufficient to keep them out of the tenant-wide /dashboard/reschedule queue. The only defense
  // is the role gate in DashboardLayout (`if (isPortalRole(ctx.role)) redirect('/portal')`). This test
  // pins both halves of that invariant so the gap can't silently reopen.
  it('list is held by portal roles too, so the dashboard tree must be gated by isPortalRole', () => {
    for (const r of ['parent', 'student']) {
      expect(can(r, { rescheduleRequest: ['list'] })).toBe(true) // why the page guard is insufficient
      expect(isPortalRole(r)).toBe(true) // why DashboardLayout redirects them to /portal
    }
    // Staff who legitimately see the queue are NOT redirected out of the dashboard.
    for (const r of ['owner', 'admin', 'teacher', 'assistant']) {
      expect(can(r, { rescheduleRequest: ['list'] })).toBe(true)
      expect(isPortalRole(r)).toBe(false)
    }
  })
})
