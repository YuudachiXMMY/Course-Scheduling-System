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

  it('teacher can course:update and lesson:update', () => {
    expect(can('teacher', { course: ['update'] })).toBe(true)
    expect(can('teacher', { lesson: ['update'] })).toBe(true)
  })

  it('owner can create courses and lessons', () => {
    expect(can('owner', { course: ['create'] })).toBe(true)
    expect(can('owner', { lesson: ['create'] })).toBe(true)
  })
})
