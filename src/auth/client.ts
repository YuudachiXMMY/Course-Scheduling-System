import { createAuthClient } from 'better-auth/react'
import { organizationClient, adminClient } from 'better-auth/client/plugins'
import { ac, orgRoles, adminAc, adminRoles } from '@/auth/permissions'

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  plugins: [
    organizationClient({ ac, roles: orgRoles }),
    adminClient({ ac: adminAc, roles: adminRoles }),
  ],
})
