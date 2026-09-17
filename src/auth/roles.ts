// Pure role display + classification helpers — NO 'server-only', NO DB. Safe to import from Client
// Components (staff-form / staff-controls) as well as Server Components. Authorization lives in
// staff-authz.ts; this module is only labels + the admin-vs-teacher tier split + assignable-role lists.
//
// member.role may be a comma-separated multi-role string (Better Auth allows it), so every helper here
// parses the list first — mirrors isPortalRole in @/auth/portal.

// The four staff (dashboard-login) org roles, in descending privilege. Portal roles (parent/student)
// are intentionally excluded — they are managed on the 家长 tab, not here.
export const STAFF_ROLES = ['owner', 'admin', 'teacher', 'assistant'] as const
export type StaffRole = (typeof STAFF_ROLES)[number]

// The "admin tier" — a member whose management is reserved for a super admin (see assertCanManageRole).
export const ADMIN_TIER_ROLES = ['owner', 'admin'] as const

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

// True if ANY of the member's (comma-multi) roles is owner/admin — i.e. an admin-tier account that only
// a super admin may create/change/deactivate.
export function isAdminRole(role: string): boolean {
  const roles = role.split(',').map((r) => r.trim())
  return roles.some((r) => (ADMIN_TIER_ROLES as readonly string[]).includes(r))
}
