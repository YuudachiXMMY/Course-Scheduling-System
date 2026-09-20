// Pure role display + classification helpers — NO 'server-only', NO DB. Safe to import from Client
// Components (staff-form / staff-controls) as well as Server Components. Authorization lives in
// staff-authz.ts; this module is only labels + the admin-vs-teacher tier split + assignable-role lists.
//
// member.role may be a comma-separated multi-role string (Better Auth allows it), so every helper here
// parses the list first — mirrors isPortalRole in @/auth/portal.

// The four staff (dashboard-login) org roles, in descending privilege. Portal roles (parent/student)
// are intentionally excluded — they are managed on the 家长 tab, not here.
export const STAFF_ROLES = ['owner', 'admin', 'teacher', 'assistant'] as const

// The "admin tier" — a member whose management is reserved for a super admin (see assertCanManageRole).
const ADMIN_TIER_ROLES = ['owner', 'admin'] as const

// The staff roles that see the WHOLE tenant's sections/students: owner/admin manage everything,
// assistant is a tenant-wide helper. A member holding ONLY the teacher role is instead confined to the
// sections they teach (see src/auth/scope.ts); the platform superadmin bypasses this at the ctx level.
const WHOLE_TENANT_ROLES = ['owner', 'admin', 'assistant'] as const

const ROLE_LABELS: Record<string, string> = {
  owner: '负责人',
  admin: '管理员',
  teacher: '教师',
  assistant: '助教',
  parent: '家长',
  student: '学生',
}

// Human-readable Chinese label for a (possibly comma-multi) member role, e.g. 'parent,student' → '家长 / 学生'.
// Also fixes PR#32 LOW#4 (raw comma role string leaking into the UI) wherever staff/portal rows are shown.
export function roleLabel(role: string): string {
  return role
    .split(',')
    .map((r) => ROLE_LABELS[r.trim()] ?? r.trim())
    .join(' / ')
}

// True if a member's (comma-multi) role list contains `target`. The single home for the comma-split
// membership test that the users tabs need — the 家长/学生 tab split in data.ts and the studentAccounts
// derivation in students-tab.tsx both call it, so the parsing rule lives in exactly one place.
export function hasRole(role: string, target: string): boolean {
  return role
    .split(',')
    .map((r) => r.trim())
    .includes(target)
}

// True if ANY of the member's (comma-multi) roles is owner/admin — i.e. an admin-tier account that only
// a super admin may create/change/deactivate.
export function isAdminRole(role: string): boolean {
  const roles = role.split(',').map((r) => r.trim())
  return roles.some((r) => (ADMIN_TIER_ROLES as readonly string[]).includes(r))
}

// True if ANY of the member's (comma-multi) roles grants whole-tenant visibility (owner/admin/assistant).
export function hasWholeTenantRole(role: string): boolean {
  const roles = role.split(',').map((r) => r.trim())
  return roles.some((r) => (WHOLE_TENANT_ROLES as readonly string[]).includes(r))
}

// True if the member is confined to the sections they teach: holds the teacher role and NO wider staff
// role. (parent/student never reach a dashboard scope, so they classify as false here.)
export function isSectionScopedRole(role: string): boolean {
  if (hasWholeTenantRole(role)) return false
  return role
    .split(',')
    .map((r) => r.trim())
    .includes('teacher')
}
