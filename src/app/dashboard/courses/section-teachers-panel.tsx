'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { roleLabel } from '@/auth/roles'
import {
  addSectionTeacher,
  removeSectionTeacher,
  type SectionTeacherRow,
} from './section-teacher-actions'

interface TeacherOption {
  id: string
  name: string
}

// 多教师/助教 — the 班级设置 panel where an admin assigns MULTIPLE teachers/assistants to a section. A
// section-scoped teacher/assistant renders this read-only (canManage=false): they see WHO teaches the
// section but cannot add/remove. Mirrors section-roster.tsx's add-picker + list shape.
export default function SectionTeachersPanel({
  sectionId,
  teachers,
  candidates,
  canManage,
}: {
  sectionId: string
  teachers: SectionTeacherRow[]
  candidates: TeacherOption[]
  canManage: boolean
}) {
  const [pick, setPick] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const assignedIds = new Set(teachers.map((t) => t.userId))
  const available = candidates.filter((c) => !assignedIds.has(c.id))

  function add() {
    if (!pick) return
    setError(null)
    startTransition(async () => {
      try {
        const res = await addSectionTeacher({ sectionId, userId: pick })
        if (!res.ok) {
          setError(res.error)
          return
        }
        setPick('')
        router.refresh()
      } catch {
        setError('添加失败，请重试')
      }
    })
  }

  function remove(userId: string) {
    setError(null)
    startTransition(async () => {
      try {
        const res = await removeSectionTeacher({ sectionId, userId })
        if (!res.ok) {
          setError(res.error)
          return
        }
        router.refresh()
      } catch {
        setError('移除失败，请重试')
      }
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
        {teachers.length === 0 && (
          <li className="px-3 py-2 text-xs text-neutral-400">
            暂无教师/助教{canManage ? '，请在下方添加。' : '。'}
          </li>
        )}
        {teachers.map((t) => (
          <li key={t.userId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              <span>{t.name}</span>
              {t.role && (
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">
                  {roleLabel(t.role)}
                </span>
              )}
              {t.isPrimary && (
                <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600">主讲</span>
              )}
            </span>
            {canManage && (
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(t.userId)}
                className="shrink-0 rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                移除
              </button>
            )}
          </li>
        ))}
      </ul>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`add-teacher-${sectionId}`}>
            添加教师/助教
          </label>
          <select
            id={`add-teacher-${sectionId}`}
            className="rounded border border-neutral-300 px-2 py-1 text-sm"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            disabled={pending || available.length === 0}
          >
            <option value="">
              {available.length === 0 ? '无可添加的教师/助教' : '选择教师/助教…'}
            </option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={pending || !pick}
            onClick={add}
            className="rounded bg-neutral-900 px-3 py-1 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            添加
          </button>
        </div>
      )}

      {error && (
        <p aria-live="polite" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
