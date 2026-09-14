import 'server-only'
import { auth } from '@/auth/auth'

// Phase 7a — provision a parent/student login (P7a-1). Two trusted server calls:
//   1) auth.api.createUser — mints a credential (email+password) user. Called WITHOUT headers, which
//      is an allowed trusted server op in Better Auth 1.7.4 (verified: createUser only requires a
//      session when ctx.request/ctx.headers are present). The user.create.after hook is branched
//      (P7a-2) to NOT self-tenant the '/admin/create-user' path, so this user gets no junk org.
//   2) auth.api.addMember — adds that user to the tutor's org with role 'parent'/'student'
//      (server-only, no email/invite). Its single membership makes session.create.before resolve
//      the correct activeOrganizationId at login.
export async function provisionPortalMember(args: {
  name: string
  email: string
  password: string
  orgId: string
  orgRole: 'parent' | 'student'
}): Promise<{ userId: string }> {
  const created = await auth.api.createUser({
    body: { email: args.email, password: args.password, name: args.name },
  })
  const userId = created.user.id
  await auth.api.addMember({
    body: { userId, role: args.orgRole, organizationId: args.orgId },
  })
  return { userId }
}
