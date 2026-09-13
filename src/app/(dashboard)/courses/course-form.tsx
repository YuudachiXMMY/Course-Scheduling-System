'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createCourse } from './actions'

export default function CourseForm() {
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [level, setLevel] = useState('')
  const [duration, setDuration] = useState('60')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function submit() {
    setError(null)
    startTransition(async () => {
      try {
        await createCourse({
          title,
          subject,
          level,
          defaultDurationMinutes: Number(duration),
        })
        setTitle('')
        setSubject('')
        setLevel('')
        setDuration('60')
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : '保存失败')
      }
    })
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
      <div>
        <button
          type="button"
          disabled={pending}
          className="rounded bg-neutral-900 px-3 py-1 text-xs text-white disabled:opacity-50"
          onClick={submit}
        >
          添加课程
        </button>
      </div>
    </div>
  )
}
