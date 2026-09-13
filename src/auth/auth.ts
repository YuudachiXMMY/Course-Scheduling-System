import { betterAuth } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter' // R5 (fallback: 'better-auth/adapters/drizzle')
import { organization, admin as adminPlugin } from 'better-auth/plugins'
import { nextCookies } from 'better-auth/next-js'
import { nanoid } from 'nanoid'
import { eq } from 'drizzle-orm'
import { db, schema } from '@/db'
import { member } from '@/db/schema' // re-exported from auth-schema via barrel (R8)
import { ac, orgRoles, adminAc, adminRoles } from '@/auth/permissions'

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'pg', schema }), // provider 'pg' = Postgres dialect (works with postgres.js)
  emailAndPassword: { enabled: true, requireEmailVerification: false }, // MVP: owner/teacher only
  advanced: { database: { generateId: () => nanoid() } }, // R3: align auth ids with app nanoid PKs
  session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
  databaseHooks: {
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
    adminPlugin({ ac: adminAc, roles: adminRoles, adminRoles: ['superadmin'], defaultRole: 'user' }),
    nextCookies(), // R6: MUST be last
  ],
})
export type Auth = typeof auth
export type Session = typeof auth.$Infer.Session
