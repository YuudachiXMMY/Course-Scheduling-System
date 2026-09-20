import { requireAuthContext } from '@/auth/context'
import { can, requirePermission } from '@/auth/authorize'
import { hasRole } from '@/auth/roles'
import { env } from '@/env'
import { listStudents } from '../students/actions'
import { getActiveShare } from '../students/share-data'
import StudentForm from '../students/student-form'
import StudentRestore from '../students/student-restore'
import ExportPanel from '../students/export-panel'
import PortalAccountForm from '../students/portal-account-form'
import { listPortalUsers } from './data'
import { LinkControl, UnlinkButton } from './link-control'
import ResetPasswordControl from './reset-password-control'
import { formatDateTime } from '@/lib/format-datetime'

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
  // 学生门户账号「合二为一」到在读学生：不再有顶部独立账号列表，每个在读学生行内直接显示其 student-kind
  // 登录状态（已开通 → 邮箱 + 重置密码；未开通 → 开通入口）。comma-multi aware：'parent,student' 账号也算。
  const activeIds = new Set(active.map((s) => s.id))
  const studentAccounts = portalUsers.filter((u) => hasRole(u.role, 'student'))
  const studentLoginsByStudent = new Map<
    string,
    { userId: string; name: string; email: string }[]
  >()
  for (const u of studentAccounts) {
    for (const s of u.students) {
      if (!activeIds.has(s.id)) continue // 归档/其他学生不在活跃列表，跳过（避免挂错行）
      const arr = studentLoginsByStudent.get(s.id) ?? []
      arr.push({ userId: u.userId, name: u.name, email: u.email })
      studentLoginsByStudent.set(s.id, arr)
    }
  }
  // 兜底：role=student 但未关联任何在读学生的孤立账号（可经家长 tab 的 UserForm 直接建出，无学生行可挂靠）。
  // 仅在非空时渲染 —— 保住其唯一的管理入口（改密），不是与学生行冗余的并列表。
  const orphanStudentAccounts = studentAccounts.filter(
    (u) => !u.students.some((s) => activeIds.has(s.id)),
  )

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
                    <span className="text-xs text-neutral-400">
                      创建于 {formatDateTime(s.createdAt)} · 最近修改 {formatDateTime(s.updatedAt)}
                    </span>
                  </div>
                  <StudentForm student={s} />
                </div>
                <ExportPanel
                  studentId={s.id}
                  token={shareByStudent.get(s.id)?.token ?? null}
                  shareOrigin={env.NEXT_PUBLIC_APP_URL}
                />
                {/* 学生登录（合并视图）：已开通→邮箱+重置密码；未开通→固定 student 的开通入口。 */}
                {canManageUsers &&
                  (() => {
                    const logins = studentLoginsByStudent.get(s.id) ?? []
                    if (logins.length === 0) {
                      return (
                        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                          <span>学生登录：未开通</span>
                          <PortalAccountForm
                            studentId={s.id}
                            studentName={s.name}
                            fixedKind="student"
                            buttonLabel="开通学生门户账号"
                          />
                        </div>
                      )
                    }
                    return (
                      <div className="flex flex-col gap-1.5 text-xs text-neutral-500">
                        {logins.map((l) => (
                          <div key={l.userId} className="flex flex-wrap items-center gap-2">
                            <span>
                              学生登录：
                              <span className="font-mono text-neutral-600">{l.email}</span>
                            </span>
                            <ResetPasswordControl targetUserId={l.userId} />
                          </div>
                        ))}
                      </div>
                    )
                  })()}
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
      {canManageUsers && orphanStudentAccounts.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-neutral-700 tabular-nums">
            未关联学生的学生账号（{orphanStudentAccounts.length}）
          </h3>
          <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
            {orphanStudentAccounts.map((u) => (
              <li
                key={u.userId}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <div className="flex flex-col">
                  <span className="text-sm font-medium">
                    {u.name} <span className="text-xs font-normal text-neutral-500">{u.role}</span>
                  </span>
                  <span className="font-mono text-xs text-neutral-500">{u.email}</span>
                  <span className="text-xs text-neutral-400">
                    尚未关联任何在读学生，可在上方学生条目「关联家长/学生账号」中关联
                  </span>
                </div>
                <ResetPasswordControl targetUserId={u.userId} />
              </li>
            ))}
          </ul>
        </div>
      )}
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
