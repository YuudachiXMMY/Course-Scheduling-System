import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { env } from '@/env'
import { listStudents } from './actions'
import { getActiveShare } from './share-data'
import StudentForm from './student-form'
import StudentRestore from './student-restore'
import ExportPanel from './export-panel'
import PortalAccountForm from './portal-account-form'

export default async function StudentsPage() {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { student: ['list'] })
  const students = await listStudents()
  const active = students.filter((s) => s.status !== 'archived')
  const archived = students.filter((s) => s.status === 'archived')
  // Single-tutor scale: fetch each active student's current active share in parallel.
  const shares = await Promise.all(active.map((s) => getActiveShare(ctx, s.id)))
  const shareByStudent = new Map(active.map((s, i) => [s.id, shares[i]]))

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">学生</h2>
      </div>
      <StudentForm />
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-neutral-700">在读学生（{active.length}）</h3>
        <ul className="divide-y divide-neutral-200 rounded border border-neutral-200">
          {active.length === 0 && <li className="px-4 py-3 text-sm text-neutral-500">暂无学生</li>}
          {active.map((s) => (
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
            </li>
          ))}
        </ul>
      </div>
      {archived.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-neutral-700">已归档（{archived.length}）</h3>
          <ul className="divide-y divide-neutral-200 rounded border border-neutral-200">
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
