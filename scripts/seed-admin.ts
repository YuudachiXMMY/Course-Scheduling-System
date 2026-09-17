// Idempotent env seed of the DEFAULT organization + a single super admin (org `owner` + platform
// `superadmin`). Run by docker/entrypoint.sh AFTER migrate, BEFORE the server starts — because
// self-service signup is disabled (src/auth/auth.ts), this seed is the ONLY way a fresh deploy gets
// a login. Locally: `npm run db:seed:admin`.
//
// Runtime: bundled to dist/seed-admin.mjs by esbuild with `--conditions=react-server` (Dockerfile),
// which resolves the transitive `import 'server-only'` (via @/db, @/auth/auth) to an empty module so
// this plain-Node script can reuse the real app data layer — the same trick scripts/seed-e2e.ts uses.
//
// Design notes:
//   - createUser + addMember are Better Auth's only HEADERLESS-callable trusted ops (createUser is the
//     documented exception to the admin-session guard; addMember is server-only with no session check).
//     banUser/setRole/updateMemberRole all require a live admin session, so we set the platform role by
//     writing user.role directly (mirrors seed-e2e's direct writes) — a seed runs with no session.
//   - createUser triggers the user.create.after hook, but that hook self-tenants ONLY for the
//     '/sign-up/email' path; the '/admin/create-user' path returns early, so the admin gets NO junk
//     org and we attach it to DEFAULT_ORG_ID explicitly.
//   - Idempotent: re-running never recreates the user (password untouched), never rewrites the org
//     name, and never adds a duplicate membership. An advisory lock (mirrors scripts/migrate.ts)
//     serialises concurrent replicas so two boots can't race a double-create.
import { and, eq } from 'drizzle-orm'
import postgres from 'postgres'
import { pathToFileURL } from 'node:url'
import { auth } from '@/auth/auth'
import { db } from '@/db'
import { user, member, organization } from '@/db/schema'
import { env } from '@/env'

const LOCK_KEY = 728934124 // distinct from migrate.ts's key; serialises concurrent seed-admin runs

export interface SeedAdminOptions {
  email?: string
  password?: string
  name?: string
  orgId?: string
  orgName?: string
}
export type SeedAdminResult = {
  status: 'skipped' | 'created' | 'existing'
  userId?: string
  orgId: string
}

export async function seedAdmin(opts: SeedAdminOptions = {}): Promise<SeedAdminResult> {
  const email = (opts.email ?? env.ADMIN_EMAIL)?.toLowerCase()
  const password = opts.password ?? env.ADMIN_PASSWORD
  const name = opts.name ?? env.ADMIN_NAME
  const orgId = opts.orgId ?? env.DEFAULT_ORG_ID
  const orgName = opts.orgName ?? env.DEFAULT_ORG_NAME

  if (!email || !password) {
    console.warn(
      '[seed-admin] ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping admin seed. ' +
        'Self-service signup is disabled, so set them before first deploy or nobody can log in.',
    )
    return { status: 'skipped', orgId }
  }

  // Advisory lock on a dedicated max:1 connection (mirror migrate.ts). The lock is what serialises
  // replicas; the actual writes go through the app `db` while we hold it.
  const sql = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} })
  try {
    await sql`SELECT pg_advisory_lock(${LOCK_KEY})`

    // 1) Upsert the default organization. onConflictDoNothing swallows a re-run (same id) AND any
    //    slug collision, so the name is never rewritten on a second seed. createdAt has NO db default.
    await db
      .insert(organization)
      .values({ id: orgId, name: orgName, slug: orgId, createdAt: new Date() })
      .onConflictDoNothing()

    // 2) Find-or-create the admin user. Existing → keep it as-is (password NEVER changed on re-seed).
    const [existing] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email))
      .limit(1)
    let userId: string
    let created = false
    if (existing) {
      userId = existing.id
    } else {
      const res = await auth.api.createUser({ body: { email, password, name } })
      userId = res.user.id
      created = true
    }

    // 3) Ensure the PLATFORM super admin role (user.role) — direct write; setRole needs a session.
    //    getAuthContext reads session.user.role at login, so the role takes effect on next sign-in.
    await db.update(user).set({ role: 'superadmin' }).where(eq(user.id, userId))

    // 4) Ensure exactly one owner membership in the default org (headerless addMember, no duplicates).
    const [m] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
      .limit(1)
    if (!m) {
      await auth.api.addMember({ body: { userId, role: 'owner', organizationId: orgId } })
    }

    console.log(
      `[seed-admin] done — ${created ? 'created' : 'existing'} super admin <${email}> ` +
        `as owner of org "${orgId}"`,
    )
    return { status: created ? 'created' : 'existing', userId, orgId }
  } finally {
    await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`
    await sql.end({ timeout: 5 })
  }
}

// Run only when executed directly (node scripts/seed-admin.ts / node dist/seed-admin.mjs), NOT when
// imported by vitest. Non-zero exit on real failure aborts the docker entrypoint (never serve a
// half-initialised deploy); a missing ADMIN_* is a clean skip (exit 0), not a failure.
const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) {
  seedAdmin()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('[seed-admin] FAILED:', e?.message ?? e)
      console.error(e?.stack)
      process.exit(1)
    })
}
