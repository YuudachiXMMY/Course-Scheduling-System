import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { isSuperAdmin } from '@/auth/staff-authz'
import { isAdminRole, roleLabel } from '@/auth/roles'
import { listStaff } from './data'
import StaffForm from './staff-form'
import { StaffRoleControl, StaffActiveToggle } from './staff-controls'

// 管理员 tab of /dashboard/users — owner/admin accounts. Visible to every org manager, but WRITE controls
// render ONLY for a super admin — a regular admin sees admins strictly read-only (the "普通 admin 对 admin
// 只读" requirement). The Server Action + core (assertCanManageRole) enforce the exact same rule, so a
// hand-rolled request cannot bypass the hidden UI.
export default async function AdminsTab() {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { member: ['create'] })
  const isSuper = isSuperAdmin(ctx)
  const staff = await listStaff(ctx)
  const admins = staff.filter((s) => isAdminRole(s.role)) // owner / admin only

  const assignable = ['admin', 'teacher', 'assistant'].map((r) => ({
    value: r,
    label: roleLabel(r),
  }))

  return (
    <section className="flex flex-col gap-6">
      {isSuper ? (
        <StaffForm roleOptions={[{ value: 'admin', label: roleLabel('admin') }]} />
      ) : (
        <p className="text-xs text-neutral-500">
          管理员账号仅超级管理员可创建 / 修改 / 停用；此处只读。
        </p>
      )}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-neutral-700 tabular-nums">
          管理员（{admins.length}）
        </h3>
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
          {admins.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-neutral-500">暂无管理员账号</li>
          )}
          {admins.map((s) => {
            const isSelf = s.userId === ctx.userId
            const isOwner = s.role
              .split(',')
              .map((r) => r.trim())
              .includes('owner')
            // Write controls: super admin only, and never on the owner row or on yourself — the last-owner
            // and self guards in the core would reject those anyway, so hide them to keep UI == capability.
            const showControls = isSuper && !isOwner && !isSelf
            return (
              <li
                key={s.userId}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <div className="flex flex-col">
                  <span className="text-sm font-medium">
                    {s.name}{' '}
                    <span className="text-xs font-normal text-neutral-500">
                      {roleLabel(s.role)}
                    </span>
                    {s.banned && <span className="ml-1 text-xs text-red-500">已停用</span>}
                  </span>
                  <span className="font-mono text-xs text-neutral-500">{s.email}</span>
                </div>
                {showControls && (
                  <div className="flex items-center gap-2">
                    <StaffRoleControl userId={s.userId} currentRole={s.role} options={assignable} />
                    <StaffActiveToggle userId={s.userId} banned={s.banned} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
