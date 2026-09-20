import { requireAuthContext } from '@/auth/context'
import ChangePasswordForm from '@/components/change-password-form'

// Portal account settings (/portal/account) — self-service password change for parent/student logins. The
// portal layout already gates to portal roles; requireAuthContext re-checks the principal. The consent gate
// in the layout still fronts this page until the family has acknowledged the data notice.
export default async function PortalAccountPage() {
  await requireAuthContext()
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <h2 className="text-lg font-semibold">账户设置</h2>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-neutral-700">修改密码</h3>
        <ChangePasswordForm />
      </div>
    </section>
  )
}
