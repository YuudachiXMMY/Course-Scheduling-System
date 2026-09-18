import { createAuthClient } from 'better-auth/react'
import { adminClient } from 'better-auth/client/plugins'
import { adminAc, adminRoles } from '@/auth/permissions'

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  // B42: organizationClient removed. The app never calls authClient.organization.*, and its presence
  // exposed a client-side org-create surface on top of the (now closed) server endpoint. Tenants are
  // provisioned server-side only (provision.ts + the self-signup hook). adminClient stays for the
  // platform-admin surface.
  plugins: [adminClient({ ac: adminAc, roles: adminRoles })],
})
