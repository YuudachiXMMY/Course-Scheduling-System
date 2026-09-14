import { createAccessControl } from 'better-auth/plugins/access'
import {
  defaultStatements as orgDefaults,
  ownerAc,
  adminAc as orgAdminAc,
  memberAc,
} from 'better-auth/plugins/organization/access'
import {
  defaultStatements as adminDefaults,
  adminAc as sysAdminAc,
} from 'better-auth/plugins/admin/access'

/* 1) ORGANIZATION (per-tenant) access control */
export const statement = {
  ...orgDefaults, // organization, member, invitation (built-in org mgmt)
  student: ['create', 'read', 'list', 'update', 'delete'],
  course: ['create', 'read', 'list', 'update', 'delete'],
  lesson: ['create', 'read', 'list', 'update', 'delete'],
  // RESERVED (declared now so the role matrix stays forward-stable):
  rescheduleRequest: ['create', 'read', 'list', 'approve', 'reject', 'cancel'],
  creditPackage: ['create', 'read', 'list', 'update', 'delete'],
  report: ['create', 'read', 'list', 'update', 'approve'], // Phase 5: progress reports
} as const
export type Statements = typeof statement
export const ac = createAccessControl(statement)

export const owner = ac.newRole({
  ...ownerAc.statements,
  student: ['create', 'read', 'list', 'update', 'delete'],
  course: ['create', 'read', 'list', 'update', 'delete'],
  lesson: ['create', 'read', 'list', 'update', 'delete'],
  rescheduleRequest: ['create', 'read', 'list', 'approve', 'reject', 'cancel'],
  creditPackage: ['create', 'read', 'list', 'update', 'delete'],
  report: ['create', 'read', 'list', 'update', 'approve'],
})
export const admin = ac.newRole({
  ...orgAdminAc.statements,
  student: ['create', 'read', 'list', 'update', 'delete'],
  course: ['create', 'read', 'list', 'update', 'delete'],
  lesson: ['create', 'read', 'list', 'update', 'delete'],
  rescheduleRequest: ['read', 'list', 'approve', 'reject'],
  creditPackage: ['create', 'read', 'list', 'update'],
  report: ['create', 'read', 'list', 'update', 'approve'],
})
export const teacher = ac.newRole({
  ...memberAc.statements,
  student: ['create', 'read', 'list', 'update'],
  course: ['create', 'read', 'list', 'update'],
  lesson: ['create', 'read', 'list', 'update'],
  rescheduleRequest: ['read', 'list', 'approve', 'reject'],
  creditPackage: ['read', 'list'],
  report: ['create', 'read', 'list', 'update', 'approve'],
})
export const assistant = ac.newRole({
  ...memberAc.statements,
  student: ['read', 'list'],
  course: ['read', 'list'],
  lesson: ['create', 'read', 'list', 'update'],
  rescheduleRequest: ['read', 'list'],
  creditPackage: ['read', 'list'],
  report: ['read', 'list'], // assistant may view reports but not draft/approve
})
// Phase-1: parent/student are READ-only placeholders; their only future WRITE is a RescheduleRequest (Phase 7).
export const parent = ac.newRole({
  student: ['read'],
  lesson: ['read', 'list'],
  rescheduleRequest: ['create', 'read', 'list', 'cancel'],
})
export const student_role = ac.newRole({
  lesson: ['read', 'list'],
  rescheduleRequest: ['create', 'read', 'list', 'cancel'],
})

export const orgRoles = { owner, admin, teacher, assistant, parent, student: student_role }
export type OrgRole = keyof typeof orgRoles

/* 2) PLATFORM (cross-tenant) admin — the self-hosting operator; a SEPARATE ac universe */
export const adminStatement = { ...adminDefaults } as const
export const adminAc = createAccessControl(adminStatement)
export const superadmin = adminAc.newRole({ ...sysAdminAc.statements })
export const user = adminAc.newRole({})
export const adminRoles = { superadmin, user }
