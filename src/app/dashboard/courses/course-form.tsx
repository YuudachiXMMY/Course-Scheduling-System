'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createCourse, updateCourse, archiveCourse, type Course } from './actions'

export default function CourseForm({ course }: { course?: Course }) {
  const isEdit = Boolean(course)
  const [open, setOpen] = useState(!isEdit)
  const [title, setTitle] = useState(course?.title ?? '')
  const [subject, setSubject] = useState(course?.subject ?? '')
  const [level, setLevel] = useState(course?.level ?? '')
  const [duration, setDuration] = useState(String(course?.defaultDurationMinutes ?? 60))
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function submit() {
    setError(null)
    if (!title.trim()) {
      setError('课程名称不能为空')
      return
    }
    startTransition(async () => {
      try {
        const input = {
          title,
          subject,
          level,
          defaultDurationMinutes: Number(duration),
        }
        if (isEdit && course) {
          await updateCourse(course.id, input)
        } else {
          await createCourse(input)
          setTitle('')
          setSubject('')
          setLevel('')
          setDuration('60')
        }
        router.refresh()
        if (isEdit) setOpen(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : '保存失败')
      }
    })
  }

  function archive() {
    if (!course) return
    startTransition(async () => {
      await archiveCourse(course.id)
      router.refresh()
      setOpen(false)
    })
  }

  if (isEdit && !open) {
    return (
      <button
        type="button"
        className="rounded border border-neutral-300 px-3 py-1 text-xs"
        onClick={() => setOpen(true)}
      >
        编辑
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-neutral-200 p-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        <input
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
          placeholder="课程名称（如 高一数学）"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
          placeholder="科目"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
        <input
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
          placeholder="级别"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
        />
        <input
          type="number"
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
          placeholder="默认时长(分钟)"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          className="rounded bg-neutral-900 px-3 py-1 text-xs text-white disabled:opacity-50"
          onClick={submit}
        >
          {isEdit ? '保存' : '添加课程'}
        </button>
        {isEdit && (
          <>
            <button
              type="button"
              disabled={pending}
              className="rounded border border-neutral-300 px-3 py-1 text-xs"
              onClick={() => setOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              disabled={pending}
              className="rounded border border-red-300 px-3 py-1 text-xs text-red-600"
              onClick={archive}
            >
              归档
            </button>
          </>
        )}
      </div>
    </div>
  )
}
