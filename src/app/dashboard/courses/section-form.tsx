'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createSection, materializeSectionAction } from './actions'
import type { Weekday } from '@/lib/rrule-build'

const WEEKDAY_LABELS: { value: Weekday; label: string }[] = [
  { value: 'MO', label: '一' },
  { value: 'TU', label: '二' },
  { value: 'WE', label: '三' },
  { value: 'TH', label: '四' },
  { value: 'FR', label: '五' },
  { value: 'SA', label: '六' },
  { value: 'SU', label: '日' },
]

export default function SectionForm({
  courseId,
  defaultTeacherId,
}: {
  courseId: string
  defaultTeacherId: string
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [byDays, setByDays] = useState<Weekday[]>(['MO'])
  const [startTime, setStartTime] = useState('16:00')
  const [duration, setDuration] = useState('60')
  const [capacity, setCapacity] = useState('1')
  const [termStart, setTermStart] = useState('')
  const [termEnd, setTermEnd] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function toggleDay(d: Weekday) {
    setByDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))
  }

  function submit() {
    setError(null)
    setStatus(null)
    // Validate required fields client-side: in production, server-side ZodError messages are
    // redacted by Next.js and surface as the cryptic "Minified React error #441" instead of a
    // helpful message. Fail fast here with clear feedback.
    if (byDays.length === 0) {
      setError('请至少选择一个上课日')
      return
    }
    if (!termStart) {
      setError('请选择学期开始日期')
      return
    }
    if (termEnd && termEnd < termStart) {
      setError('学期结束日期不能早于开始日期')
      return
    }
    startTransition(async () => {
      try {
        const result = await createSection({
          courseId,
          name: name || undefined,
          teacherId: defaultTeacherId,
          capacity: Number(capacity),
          byDays,
          startTime,
          durationMinutes: Number(duration),
          termStartDate: termStart,
          termEndDate: termEnd || undefined,
          timezone: 'Asia/Shanghai',
        })
        if (!result.ok) {
          setError(result.error)
          return
        }
        const res = await materializeSectionAction(result.section.id)
        setStatus(
          `已生成 ${res.inserted} 节课${res.conflicts ? `，${res.conflicts} 节因冲突跳过` : ''}`,
        )
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : '保存失败')
      }
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        className="rounded border border-neutral-300 px-3 py-1 text-xs"
        onClick={() => setOpen(true)}
      >
        + 新建班级
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-neutral-200 bg-neutral-50 p-3">
      <input
        className="rounded border border-neutral-300 px-2 py-1 text-sm"
        placeholder="班级名称（如 周一班）"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="flex flex-wrap gap-1">
        {WEEKDAY_LABELS.map((d) => (
          <button
            key={d.value}
            type="button"
            onClick={() => toggleDay(d.value)}
            className={`h-7 w-7 rounded text-xs ${
              byDays.includes(d.value)
                ? 'bg-neutral-900 text-white'
                : 'border border-neutral-300 text-neutral-600'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="flex flex-col text-xs text-neutral-500">
          上课时间
          <input
            type="time"
            className="rounded border border-neutral-300 px-2 py-1 text-sm"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </label>
        <label className="flex flex-col text-xs text-neutral-500">
          时长(分钟)
          <input
            type="number"
            className="rounded border border-neutral-300 px-2 py-1 text-sm"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </label>
        <label className="flex flex-col text-xs text-neutral-500">
          容量
          <input
            type="number"
            className="rounded border border-neutral-300 px-2 py-1 text-sm"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col text-xs text-neutral-500">
          学期开始 <span className="text-red-500">*</span>
          <input
            type="date"
            required
            className="rounded border border-neutral-300 px-2 py-1 text-sm"
            value={termStart}
            onChange={(e) => setTermStart(e.target.value)}
          />
        </label>
        <label className="flex flex-col text-xs text-neutral-500">
          学期结束
          <input
            type="date"
            className="rounded border border-neutral-300 px-2 py-1 text-sm"
            value={termEnd}
            onChange={(e) => setTermEnd(e.target.value)}
          />
        </label>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {status && <p className="text-xs text-green-700">{status}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          className="rounded bg-neutral-900 px-3 py-1 text-xs text-white disabled:opacity-50"
          onClick={submit}
        >
          创建并生成课节
        </button>
        <button
          type="button"
          className="rounded border border-neutral-300 px-3 py-1 text-xs"
          onClick={() => setOpen(false)}
        >
          取消
        </button>
      </div>
    </div>
  )
}
