import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { listStudents } from '../students/actions'
import { listPortalUsers } from './data'
import UserForm from './user-form'
import { LinkControl, UnlinkButton } from './link-control'
import { formatDateTime } from '@/lib/format-datetime'

// 家长 tab of /dashboard/users — manage portal accounts (parent/student) and their student links.
// Defence-in-depth: even though the page hides this tab for non-managers, we re-check the permission
// here so a direct ?tab=parents hit can never reach the data. Owner/admin only.
export default async function ParentsTab() {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { member: ['create'] })
  const [users, students] = await Promise.all([listPortalUsers(ctx), listStudents()])
  const activeStudents = students.filter((s) => s.status !== 'archived')

  return (
    <section className="flex flex-col gap-6">
      <UserForm />
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-neutral-700 tabular-nums">门户账号（{users.length}）</h3>
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
          {users.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-neutral-500">暂无门户账号</li>
          )}
          {users.map((u) => {
            const linkedIds = new Set(u.students.map((s) => s.id))
            const assignable = activeStudents
              .filter((s) => !linkedIds.has(s.id))
              .map((s) => ({ value: s.id, label: s.name }))
            return (
              <li key={u.userId} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">
                      {u.name} <span className="text-xs font-normal text-neutral-500">{u.role}</span>
                    </span>
                    <span className="font-mono text-xs text-neutral-500">{u.email}</span>
                    <span className="text-xs text-neutral-400">
                      创建于 {formatDateTime(u.createdAt)} · 最近修改 {formatDateTime(u.updatedAt)}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-neutral-500">
                    关联学生
                    {u.students.length === 0 && <span className="text-neutral-400">：暂无</span>}
                  </span>
                  {u.students.length > 0 && (
                    <ul className="flex flex-wrap gap-2">
                      {u.students.map((s) => (
                        <li
                          key={s.id}
                          className="flex items-center gap-1 rounded bg-neutral-100 px-2 py-0.5 text-xs"
                        >
                          <span>{s.name}</span>
                          <UnlinkButton userId={u.userId} studentId={s.id} />
                        </li>
                      ))}
                    </ul>
                  )}
                  <LinkControl label="关联学生…" options={assignable} fixedUserId={u.userId} />
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
