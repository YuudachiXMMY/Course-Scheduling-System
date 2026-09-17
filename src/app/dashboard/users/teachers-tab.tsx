import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { isSuperAdmin } from '@/auth/staff-authz'
import { isAdminRole, roleLabel } from '@/auth/roles'
import { listStaff } from './data'
import StaffForm from './staff-form'
import { StaffRoleControl, StaffActiveToggle } from './staff-controls'

// 教师 tab of /dashboard/users — teacher/assistant staff accounts. Defence-in-depth: the page already
// gates admin+, but we re-check member:create here so a direct hit still can't reach the data. Any org
// manager (owner/admin) may create / re-role / deactivate these non-admin accounts; a super admin also
// gets an 管理员 option in the role picker (which moves the row into the 管理员 tab).
export default async function TeachersTab() {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { member: ['create'] })
  const isSuper = isSuperAdmin(ctx)
  const staff = await listStaff(ctx)
  const teachers = staff.filter((s) => !isAdminRole(s.role)) // teacher / assistant only

  const createRoles = [
    { value: 'teacher', label: roleLabel('teacher') },
    { value: 'assistant', label: roleLabel('assistant') },
  ]
  // Roles the actor may ASSIGN via the row picker. owner is seed-only and never offered; admin only for a
  // super admin (a regular admin's setStaffRole to 'admin' is refused by assertCanManageRole anyway).
  const assignable = (isSuper ? ['admin', 'teacher', 'assistant'] : ['teacher', 'assistant']).map(
    (r) => ({ value: r, label: roleLabel(r) }),
  )

  return (
    <section className="flex flex-col gap-6">
      <StaffForm roleOptions={createRoles} />
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-neutral-700 tabular-nums">
          教师 / 助教（{teachers.length}）
        </h3>
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
          {teachers.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-neutral-500">暂无教师账号</li>
          )}
          {teachers.map((s) => {
            const isSelf = s.userId === ctx.userId
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
                {!isSelf && (
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
