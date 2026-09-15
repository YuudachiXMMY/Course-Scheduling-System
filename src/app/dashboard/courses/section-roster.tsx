'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  enrollStudent,
  unenrollStudent,
  listSectionEnrollments,
} from '../schedule/enrollment-actions'

interface StudentOption {
  id: string
  name: string
}

export default function SectionRoster({
  sectionId,
  capacity,
  students,
}: {
  sectionId: string
  capacity: number
  students: StudentOption[]
}) {
  const [open, setOpen] = useState(false)
  const [enrolledIds, setEnrolledIds] = useState<string[]>([])
  const [pick, setPick] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  useEffect(() => {
    if (!open) return
    let active = true
    listSectionEnrollments(sectionId).then((rows) => {
      if (!active) return
      setEnrolledIds(rows.map((r) => r.studentId))
      setLoaded(true)
    })
    return () => {
      active = false
    }
  }, [open, sectionId])

  const nameById = new Map(students.map((s) => [s.id, s.name]))
  const available = students.filter((s) => !enrolledIds.includes(s.id))

  function add() {
    if (!pick) return
    setError(null)
    startTransition(async () => {
      try {
        await enrollStudent({ studentId: pick, sectionId })
        setEnrolledIds((prev) => [...prev, pick])
        setPick('')
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : '添加失败')
      }
    })
  }

  function remove(studentId: string) {
    setError(null)
    startTransition(async () => {
      try {
        await unenrollStudent({ studentId, sectionId })
        setEnrolledIds((prev) => prev.filter((id) => id !== studentId))
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : '移除失败')
      }
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        className="shrink-0 rounded border border-neutral-300 px-2 py-1 text-neutral-700"
        onClick={() => setOpen(true)}
      >
        管理学生
      </button>
    )
  }

  return (
    <div className="mt-1 flex w-full flex-col gap-2 rounded border border-neutral-200 bg-neutral-50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-neutral-700">
          在读学生 {enrolledIds.length}/{capacity}
        </span>
        <button type="button" className="text-xs text-neutral-500" onClick={() => setOpen(false)}>
          收起
        </button>
      </div>
      {!loaded && <p className="text-xs text-neutral-500">加载中…</p>}
      {loaded && enrolledIds.length === 0 && (
        <p className="text-xs text-neutral-400">暂无在读学生</p>
      )}
      <ul className="flex flex-col gap-1">
        {enrolledIds.map((id) => (
          <li key={id} className="flex items-center justify-between text-xs text-neutral-700">
            <span>{nameById.get(id) ?? id}</span>
            <button
              type="button"
              disabled={pending}
              className="rounded border border-red-300 px-2 py-0.5 text-red-600 disabled:opacity-50"
              onClick={() => remove(id)}
            >
              移除
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <select
          className="flex-1 rounded border border-neutral-300 px-2 py-1 text-xs"
          value={pick}
          onChange={(e) => setPick(e.target.value)}
        >
          <option value="">选择学生…</option>
          {available.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={pending || !pick}
          className="rounded bg-neutral-900 px-3 py-1 text-xs text-white disabled:opacity-50"
          onClick={add}
        >
          添加
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
