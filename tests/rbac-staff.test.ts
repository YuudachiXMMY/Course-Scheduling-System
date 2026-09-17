import { describe, it, expect } from 'vitest'
import type { AuthContext } from '@/auth/context'
import { isSuperAdmin, assertCanManageRole } from '@/auth/staff-authz'
import { isAdminRole, roleLabel } from '@/auth/roles'

// Tiered staff-management RBAC — pure functions, no DB. Locks the "两套 AC 宇宙" split (permissions.ts):
//   - admin/owner targets  → super admin (ctx.isPlatformAdmin) ONLY;
//   - teacher/assistant/parent/student targets → any org manager (owner/admin via member:create);
//   - a teacher (no member:create) manages nobody.
const ctxFor = (role: string, isPlatformAdmin = false): AuthContext => ({
  tenantId: 'org',
  userId: 'u',
  role,
  isPlatformAdmin,
})
const superCtx = ctxFor('owner', true) // owner + platform superadmin (the seeded default admin)
const ownerCtx = ctxFor('owner') // an org owner who is NOT a platform admin
const adminCtx = ctxFor('admin')
const teacherCtx = ctxFor('teacher')

describe('assertCanManageRole — tiered staff authorization', () => {
  it('admin/owner targets require a super admin', () => {
    for (const t of ['admin', 'owner']) {
      expect(() => assertCanManageRole(adminCtx, t)).toThrow()
      expect(() => assertCanManageRole(ownerCtx, t)).toThrow() // even a non-platform owner cannot touch admins
      expect(() => assertCanManageRole(superCtx, t)).not.toThrow()
    }
  })

  it('a comma-multi role that touches admin still requires a super admin', () => {
    expect(() => assertCanManageRole(adminCtx, 'teacher,admin')).toThrow()
    expect(() => assertCanManageRole(superCtx, 'teacher,admin')).not.toThrow()
  })

  it('non-admin targets are manageable by any org manager (owner/admin)', () => {
    for (const t of ['teacher', 'assistant', 'parent', 'student']) {
      expect(() => assertCanManageRole(adminCtx, t)).not.toThrow()
      expect(() => assertCanManageRole(ownerCtx, t)).not.toThrow()
      expect(() => assertCanManageRole(superCtx, t)).not.toThrow()
    }
  })

  it('a teacher holds no member:create → manages nobody', () => {
    for (const t of ['teacher', 'assistant', 'admin', 'owner']) {
      expect(() => assertCanManageRole(teacherCtx, t)).toThrow()
    }
  })

  it('isSuperAdmin reflects the platform flag only', () => {
    expect(isSuperAdmin(superCtx)).toBe(true)
    expect(isSuperAdmin(ownerCtx)).toBe(false)
    expect(isSuperAdmin(adminCtx)).toBe(false)
  })
})

describe('role display + classification', () => {
  it('isAdminRole detects owner/admin, incl. comma-multi, and rejects the rest', () => {
    expect(isAdminRole('owner')).toBe(true)
    expect(isAdminRole('admin')).toBe(true)
    expect(isAdminRole('teacher,admin')).toBe(true)
    expect(isAdminRole('teacher')).toBe(false)
    expect(isAdminRole('assistant')).toBe(false)
    expect(isAdminRole('parent,student')).toBe(false)
  })

  it('roleLabel maps known roles to Chinese and joins comma-multi', () => {
    expect(roleLabel('owner')).toBe('负责人')
    expect(roleLabel('admin')).toBe('管理员')
    expect(roleLabel('teacher')).toBe('教师')
    expect(roleLabel('assistant')).toBe('助教')
    expect(roleLabel('parent,student')).toBe('家长 / 学生')
    expect(roleLabel('unknown')).toBe('unknown') // unmapped role falls back to its raw name
  })
})
