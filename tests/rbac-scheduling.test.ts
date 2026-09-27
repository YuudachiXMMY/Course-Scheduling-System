import { describe, it, expect } from 'vitest'
import { can } from '@/auth/authorize'

// P2-9 role-matrix regression: attendance/notes → lesson perms; roster → course perms.
describe('RBAC for scheduling writes', () => {
  it('assistant can lesson:create but not course:create', () => {
    expect(can('assistant', { lesson: ['create'] })).toBe(true)
    expect(can('assistant', { course: ['create'] })).toBe(false)
  })

  it('parent cannot lesson:create', () => {
    expect(can('parent', { lesson: ['create'] })).toBe(false)
  })

  // 多教师改造: a teacher no longer holds course:create/update (no add course/section, no course/section
  // settings, no roster enroll/unenroll — those are owner/admin only). They keep lesson:* to run their
  // classes and read course/section (view-only), plus report:*.
  it('teacher cannot course:create or course:update, but can course:read and lesson:update', () => {
    expect(can('teacher', { course: ['create'] })).toBe(false)
    expect(can('teacher', { course: ['update'] })).toBe(false)
    expect(can('teacher', { course: ['read'] })).toBe(true)
    expect(can('teacher', { course: ['list'] })).toBe(true)
    expect(can('teacher', { lesson: ['update'] })).toBe(true)
    expect(can('teacher', { lesson: ['create'] })).toBe(true)
  })

  it('owner can create courses and lessons', () => {
    expect(can('owner', { course: ['create'] })).toBe(true)
    expect(can('owner', { lesson: ['create'] })).toBe(true)
  })
})
