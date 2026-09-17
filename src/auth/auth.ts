import { betterAuth } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter' // R5 (fallback: 'better-auth/adapters/drizzle')
import { organization, admin as adminPlugin } from 'better-auth/plugins'
import { nextCookies } from 'better-auth/next-js'
import { nanoid } from 'nanoid'
import { eq } from 'drizzle-orm'
import { db, schema } from '@/db'
import { member, organization as organizationTable } from '@/db/schema' // re-exported from auth-schema via barrel (R8)
import { ac, orgRoles, adminAc, adminRoles } from '@/auth/permissions'

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'pg', schema }), // provider 'pg' = Postgres dialect (works with postgres.js)
  // Self-service sign-up is CLOSED: this is a single-operator install. disableSignUp makes the
  // /sign-up/email endpoint reject every request (EMAIL_PASSWORD_SIGN_UP_DISABLED) — verified present
  // in better-auth 1.7.4. It does NOT affect auth.api.createUser (/admin/create-user), so the env
  // admin seed and any future staff/portal provisioning keep minting accounts server-side.
  emailAndPassword: { enabled: true, requireEmailVerification: false, disableSignUp: true },
  advanced: { database: { generateId: () => nanoid() } }, // R3: align auth ids with app nanoid PKs
  session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
  databaseHooks: {
    user: {
      create: {
        // M4: give every new user their own tenant on signup. Without this, a fresh user has no
        // organization/member, the session hook below sets activeOrganizationId=null, and the
        // dashboard bounces them back to /login forever. Atomic: org + owner member together.
        //
        // NOTE (race): Better Auth persists the sign-up session a few ms BEFORE this `after` hook
        // commits, so the FIRST session still captures activeOrganizationId=null (the session hook
        // ran before the member existed). getAuthContext() self-heals that by falling back to the
        // user's membership, so the new owner is not stranded on /login. See src/auth/context.ts.
        //
        // P7a-2: this hook fires for EVERY user creation, including auth.api.createUser (admin path).
        // A provisioned parent/student must NOT get their own org — they are added to the tutor's org
        // via auth.api.addMember (see provisionPortalMember). So self-tenant ONLY for self-signup
        // (endpoint '/sign-up/email'); the admin create-user path ('/admin/create-user', or any other
        // context) is skipped. `context` is the current auth endpoint context (verified 1.7.4).
        after: async (user, context) => {
          if (context?.path !== '/sign-up/email') return
          const orgId = nanoid()
          await db.transaction(async (tx) => {
            await tx.insert(organizationTable).values({
              id: orgId,
              name: `${user.name} 的机构`,
              slug: `org-${orgId}`, // nanoid is URL-safe + unique → satisfies organization_slug_unique
              createdAt: new Date(),
            })
            await tx.insert(member).values({
              id: nanoid(),
              organizationId: orgId,
              userId: user.id,
              role: 'owner', // creator owns their tenant (mirrors organization creatorRole)
              createdAt: new Date(),
            })
          })
        },
      },
    },
    session: {
      create: {
        // Auto-select the user's default tenant on login so the session always carries a trusted tenant.
        before: async (session) => {
          const [m] = await db
            .select({ organizationId: member.organizationId })
            .from(member)
            .where(eq(member.userId, session.userId))
            .limit(1)
          return { data: { ...session, activeOrganizationId: m?.organizationId ?? null } }
        },
      },
    },
  },
  plugins: [
    organization({ ac, roles: orgRoles, creatorRole: 'owner' }),
    adminPlugin({
      ac: adminAc,
      roles: adminRoles,
      adminRoles: ['superadmin'],
      defaultRole: 'user',
    }),
    nextCookies(), // R6: MUST be last
  ],
})
export type Auth = typeof auth
export type Session = typeof auth.$Infer.Session
