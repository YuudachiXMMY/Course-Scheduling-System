// Static, deterministic E2E fixture identity — shared by the seed script (scripts/seed-e2e.ts) and
// every spec. Keep this file free of `server-only`/Node-only imports so it is safe to import from
// both the Playwright runner and the seed process. Dynamic ids (userId/studentId/lessonId/...) that
// only exist after seeding are written to tests/e2e/.seed/seed-data.json — read them via seed-data.ts.
//
// Everything here is namespaced with an `e2e-`/`E2E` prefix and lives under a dedicated tenant so a
// re-seed can wipe it precisely without touching real dev data in the shared database.

/** The dedicated tenant (Better Auth organizationId) that owns ALL E2E fixture rows. */
export const E2E_TENANT_ID = 'e2e_org_main'
export const E2E_ORG_NAME = 'E2E Academy'
export const E2E_ORG_SLUG = 'e2e-academy'

/** All seeded login accounts share this email domain → cheap, precise cleanup (`email LIKE '%@e2e.local'`). */
export const E2E_EMAIL_DOMAIN = 'e2e.local'
/** Every seeded account uses one password (≥ 8 chars for Better Auth). */
export const E2E_PASSWORD = 'E2ePassw0rd!'

export type E2ERole = 'owner' | 'admin' | 'teacher' | 'parent' | 'student' | 'parentNoConsent'

export interface E2EAccount {
  /** The stored-state key + seed-data key. */
  key: E2ERole
  email: string
  password: string
  /** The org-scoped member.role written to the DB. */
  memberRole: 'owner' | 'admin' | 'teacher' | 'parent' | 'student'
  /** Where the app lands this account after login (role dispatcher in src/app/page.tsx). */
  landing: '/dashboard' | '/portal'
  displayName: string
}

export const E2E_ACCOUNTS: Record<E2ERole, E2EAccount> = {
  owner: {
    key: 'owner',
    email: `e2e-owner@${E2E_EMAIL_DOMAIN}`,
    password: E2E_PASSWORD,
    memberRole: 'owner',
    landing: '/dashboard',
    displayName: 'E2E Owner',
  },
  admin: {
    key: 'admin',
    email: `e2e-admin@${E2E_EMAIL_DOMAIN}`,
    password: E2E_PASSWORD,
    memberRole: 'admin',
    landing: '/dashboard',
    displayName: 'E2E Admin',
  },
  teacher: {
    key: 'teacher',
    email: `e2e-teacher@${E2E_EMAIL_DOMAIN}`,
    password: E2E_PASSWORD,
    memberRole: 'teacher',
    landing: '/dashboard',
    displayName: 'E2E Teacher',
  },
  parent: {
    key: 'parent',
    email: `e2e-parent@${E2E_EMAIL_DOMAIN}`,
    password: E2E_PASSWORD,
    memberRole: 'parent',
    landing: '/portal',
    displayName: 'E2E Parent A',
  },
  student: {
    key: 'student',
    email: `e2e-student@${E2E_EMAIL_DOMAIN}`,
    password: E2E_PASSWORD,
    memberRole: 'student',
    landing: '/portal',
    displayName: 'E2E Student A',
  },
  // Deliberately left WITHOUT a stamped portal_link.consentedAt so the consent-gate spec can drive
  // the first-login "我已阅读并同意" flow via the UI. Linked to student B (kept apart from A's data).
  parentNoConsent: {
    key: 'parentNoConsent',
    email: `e2e-parent-noconsent@${E2E_EMAIL_DOMAIN}`,
    password: E2E_PASSWORD,
    memberRole: 'parent',
    landing: '/portal',
    displayName: 'E2E Parent B (no consent)',
  },
}

export const STAFF_ROLES: E2ERole[] = ['owner', 'admin', 'teacher']
export const PORTAL_ROLES: E2ERole[] = ['parent', 'student']
/** Roles for which global-setup mints a reusable signed-in storageState file. */
export const STORAGE_STATE_ROLES: E2ERole[] = [
  'owner',
  'admin',
  'teacher',
  'parent',
  'student',
  'parentNoConsent', // signed in but unconsented → the consent-gate spec drives the UI accept flow
]

/** Course / section / student display names — unique `E2E` prefix avoids clashing with real dev rows. */
export const E2E_FIXTURES = {
  course: { title: 'E2E 数学' },
  sectionA: { name: 'E2E 周一班' }, // student A; read-heavy (portal + share)
  sectionB: { name: 'E2E 周二班' }, // student B; owns the seeded pending reschedule request
  studentA: { name: '张三E2E', grade: '初二' },
  studentB: { name: '李四E2E', grade: '初三' },
} as const

/** Fixed, deterministic public share token for student A (globally unique; wiped + reissued per seed). */
export const E2E_SHARE_TOKEN = 'e2e-share-zhangsan-token'
/** A token guaranteed never to resolve — for the /s/[token] not-found path. */
export const E2E_INVALID_SHARE_TOKEN = 'e2e-nonexistent-token-xyz-0000'

/** Relative path (from repo root) where the seed writes dynamic ids for specs to consume. */
export const SEED_DATA_PATH = 'tests/e2e/.seed/seed-data.json'
/** Directory where global-setup writes per-role storageState JSON. */
export const AUTH_STATE_DIR = 'tests/e2e/.auth'

export function authStatePath(role: E2ERole): string {
  return `${AUTH_STATE_DIR}/${role}.json`
}
