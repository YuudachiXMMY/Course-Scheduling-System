import { requireAuthContext } from '@/auth/context'
import ChangePasswordForm from '@/components/change-password-form'

// Staff account settings (/dashboard/account) — currently just self-service password change. requireAuthContext
// bounces an unauthenticated hit to /login; any signed-in staff member may change their OWN password (the
// action verifies the current password against their live session).
export default async function AccountPage() {
  await requireAuthContext()
  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">账户设置</h2>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-neutral-700">修改密码</h3>
        <ChangePasswordForm />
      </div>
    </section>
  )
}
