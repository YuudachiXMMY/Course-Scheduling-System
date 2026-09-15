import { redirect } from 'next/navigation'
import { getAuthContext } from '@/auth/context'
import { isPortalRole } from '@/auth/portal'

// Role dispatcher: a single /login lands here, then each role goes to its home. Parent/student →
// the authenticated /portal (per-child view); everyone else (owner/teacher/admin/assistant) →
// /dashboard. Unauthenticated → /login.
export default async function RootPage() {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  redirect(isPortalRole(ctx.role) ? '/portal' : '/dashboard')
}
