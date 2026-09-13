import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { listStudents } from './actions'
import StudentForm from './student-form'

export default async function StudentsPage() {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { student: ['list'] })
  const students = await listStudents()
  const active = students.filter((s) => s.status !== 'archived')
  const archived = students.filter((s) => s.status === 'archived')

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
            <li key={s.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex flex-col">
                <span className="text-sm font-medium">{s.name}</span>
                <span className="text-xs text-neutral-500">
                  {s.schoolGrade ?? '—'} · 微信 {s.parentWechat ?? '—'}
                </span>
              </div>
              <StudentForm student={s} />
            </li>
          ))}
        </ul>
      </div>
      {archived.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-neutral-700">已归档（{archived.length}）</h3>
          <ul className="divide-y divide-neutral-200 rounded border border-neutral-200 opacity-60">
            {archived.map((s) => (
              <li key={s.id} className="px-4 py-3 text-sm">
                {s.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
