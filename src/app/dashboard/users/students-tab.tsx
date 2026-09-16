import { requireAuthContext } from '@/auth/context'
import { can, requirePermission } from '@/auth/authorize'
import { env } from '@/env'
import { listStudents } from '../students/actions'
import { getActiveShare } from '../students/share-data'
import StudentForm from '../students/student-form'
import StudentRestore from '../students/student-restore'
import ExportPanel from '../students/export-panel'
import PortalAccountForm from '../students/portal-account-form'
import { listPortalUsers } from './data'
import { LinkControl, UnlinkButton } from './link-control'

// Students tab of /dashboard/users — the former /dashboard/students page, moved here verbatim, plus a
// per-student "关联账号" row (assign an existing portal account to this student, or unlink one). The
// <h2>学生</h2> heading is preserved so the existing students e2e heading assertion stays green.
export default async function StudentsTab() {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { student: ['list'] })
  const students = await listStudents()
  const active = students.filter((s) => s.status !== 'archived')
  const archived = students.filter((s) => s.status === 'archived')
  const shares = await Promise.all(active.map((s) => getActiveShare(ctx, s.id)))
  const shareByStudent = new Map(active.map((s, i) => [s.id, shares[i]]))

  // Only org managers may manage portal-account links; teacher/assistant see students but no link UI.
  const canManageUsers = can(ctx.role, { member: ['create'] })
  const portalUsers = canManageUsers ? await listPortalUsers(ctx) : []
  // Invert into studentId → linked accounts, and keep the full account list for the assign picker.
  const linkedByStudent = new Map<string, { userId: string; name: string; role: string }[]>()
  for (const u of portalUsers) {
    for (const s of u.students) {
      const arr = linkedByStudent.get(s.id) ?? []
      arr.push({ userId: u.userId, name: u.name, role: u.role })
      linkedByStudent.set(s.id, arr)
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">学生</h2>
      </div>
      <StudentForm />
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-neutral-700 tabular-nums">
          在读学生（{active.length}）
        </h3>
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
          {active.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-neutral-500">暂无学生</li>
          )}
          {active.map((s) => {
            const linked = linkedByStudent.get(s.id) ?? []
            const linkedIds = new Set(linked.map((l) => l.userId))
            const assignable = portalUsers
              .filter((u) => !linkedIds.has(u.userId))
              .map((u) => ({ value: u.userId, label: `${u.name}（${u.role}）` }))
            return (
              <li key={s.id} className="flex flex-col gap-3 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{s.name}</span>
                    <span className="text-xs text-neutral-500">
                      {s.schoolGrade ?? '—'} · 微信 {s.parentWechat ?? '—'}
                    </span>
                  </div>
                  <StudentForm student={s} />
                </div>
                <ExportPanel
                  studentId={s.id}
                  token={shareByStudent.get(s.id)?.token ?? null}
                  shareOrigin={env.NEXT_PUBLIC_APP_URL}
                />
                <PortalAccountForm studentId={s.id} studentName={s.name} />
                {canManageUsers && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-neutral-500">
                      关联账号
                      {linked.length === 0 && <span className="text-neutral-400">：暂无</span>}
                    </span>
                    {linked.length > 0 && (
                      <ul className="flex flex-wrap gap-2">
                        {linked.map((l) => (
                          <li
                            key={l.userId}
                            className="flex items-center gap-1 rounded bg-neutral-100 px-2 py-0.5 text-xs"
                          >
                            <span>
                              {l.name}（{l.role}）
                            </span>
                            <UnlinkButton userId={l.userId} studentId={s.id} />
                          </li>
                        ))}
                      </ul>
                    )}
                    <LinkControl
                      label="关联家长/学生账号…"
                      options={assignable}
                      fixedStudentId={s.id}
                    />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>
      {archived.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-neutral-700 tabular-nums">
            已归档（{archived.length}）
          </h3>
          <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
            {archived.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between px-4 py-3 text-sm text-neutral-500"
              >
                <span>{s.name}</span>
                <StudentRestore studentId={s.id} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
