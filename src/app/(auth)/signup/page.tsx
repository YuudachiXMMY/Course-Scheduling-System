import { redirect } from 'next/navigation'

// Self-service sign-up is disabled (single-operator install; accounts are minted server-side by the
// env admin seed and by admins in /dashboard/users). The route is KEPT — instead of 404ing an old
// bookmark, it 302s to /login. The server-side backstop is auth.ts `emailAndPassword.disableSignUp`,
// which rejects /sign-up/email even if this page is bypassed.
export default function SignupPage() {
  redirect('/login')
}
