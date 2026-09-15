'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  createSection,
  updateSection,
  materializeSectionAction,
  listSectionMeetings,
  type ClassSection,
} from './actions'
import type { Weekday } from '@/lib/rrule-build'

const WEEKDAY_LABELS: { value: Weekday; label: string }[] = [
  { value: 'MO', label: '周一' },
  { value: 'TU', label: '周二' },
  { value: 'WE', label: '周三' },
  { value: 'TH', label: '周四' },
  { value: 'FR', label: '周五' },
  { value: 'SA', label: '周六' },
  { value: 'SU', label: '周日' },
]

interface MeetingRow {
  byDay: Weekday
  startTime: string
  durationMinutes: string
}

function toDateInput(d: Date | null): string {
  return d ? new Date(d).toISOString().slice(0, 10) : ''
}

export default function SectionForm({
  courseId,
  defaultTeacherId,
  section,
}: {
  courseId: string
  defaultTeacherId: string
  section?: ClassSection
}) {
  const isEdit = Boolean(section)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(section?.name ?? '')
  const [meetings, setMeetings] = useState<MeetingRow[]>([
    { byDay: 'MO', startTime: '16:00', durationMinutes: '60' },
  ])
  const [capacity, setCapacity] = useState(String(section?.capacity ?? 1))
  const [termStart, setTermStart] = useState(toDateInput(section?.termStartDate ?? null))
  const [termEnd, setTermEnd] = useState(toDateInput(section?.termEndDate ?? null))
  const [location, setLocation] = useState(section?.defaultLocation ?? '')
  const [meetingUrl, setMeetingUrl] = useState(section?.defaultMeetingUrl ?? '')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  // Edit mode: load the section's existing meeting slots to prefill the rows.
  useEffect(() => {
    if (!open || !isEdit || !section) return
    let active = true
    listSectionMeetings(section.id).then((rows) => {
      if (!active) return
      if (rows.length > 0) {
        setMeetings(
          rows.map((r) => ({
            byDay: r.byDay as Weekday,
            startTime: r.startTime,
            durationMinutes: String(r.durationMinutes),
          })),
        )
      }
    })
    return () => {
      active = false
    }
  }, [open, isEdit, section])

  function updateMeeting(i: number, patch: Partial<MeetingRow>) {
    setMeetings((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)))
  }
  function addMeeting() {
    setMeetings((prev) => [...prev, { byDay: 'MO', startTime: '16:00', durationMinutes: '60' }])
  }
  function removeMeeting(i: number) {
    setMeetings((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)))
  }

  function submit() {
    setError(null)
    setStatus(null)
    // Client-side validation: in production, server-side ZodError messages are redacted by Next.js
    // and surface as the cryptic "Minified React error #441". Fail fast here with clear feedback.
    if (meetings.length === 0) {
      setError('请至少添加一个上课时段')
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
    const payload = {
      courseId,
      name: name || undefined,
      teacherId: defaultTeacherId,
      capacity: Number(capacity),
      meetings: meetings.map((m) => ({
        byDay: m.byDay,
        startTime: m.startTime,
        durationMinutes: Number(m.durationMinutes),
      })),
      termStartDate: termStart,
      termEndDate: termEnd || undefined,
      timezone: 'Asia/Shanghai',
      defaultLocation: location || undefined,
      defaultMeetingUrl: meetingUrl || undefined,
    }
    startTransition(async () => {
      try {
        const result =
          isEdit && section
            ? await updateSection(section.id, payload)
            : await createSection(payload)
        if (!result.ok) {
          setError(result.error)
          return
        }
        const res = await materializeSectionAction(result.section.id)
        setStatus(
          `已生成 ${res.inserted} 节课${res.conflicts ? `，${res.conflicts} 节因冲突跳过` : ''}`,
        )
        router.refresh()
        if (isEdit) setOpen(false)
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
        {isEdit ? '编辑' : '+ 新建班级'}
      </button>
    )
  }

  return (
    <div className="flex w-full flex-col gap-2 rounded border border-neutral-200 bg-neutral-50 p-3">
      <input
        className="rounded border border-neutral-300 px-2 py-1 text-sm"
        placeholder="班级名称（如 周一班）"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <div className="flex flex-col gap-1">
        <span className="text-xs text-neutral-500">上课时段（可添加多个不同日期/时间）</span>
        {meetings.map((m, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select
              className="rounded border border-neutral-300 px-2 py-1 text-sm"
              value={m.byDay}
              onChange={(e) => updateMeeting(i, { byDay: e.target.value as Weekday })}
            >
              {WEEKDAY_LABELS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
            <input
              type="time"
              className="rounded border border-neutral-300 px-2 py-1 text-sm"
              value={m.startTime}
              onChange={(e) => updateMeeting(i, { startTime: e.target.value })}
            />
            <input
              type="number"
              className="w-24 rounded border border-neutral-300 px-2 py-1 text-sm"
              placeholder="时长(分)"
              value={m.durationMinutes}
              onChange={(e) => updateMeeting(i, { durationMinutes: e.target.value })}
            />
            <button
              type="button"
              disabled={meetings.length <= 1}
              className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 disabled:opacity-40"
              onClick={() => removeMeeting(i)}
            >
              删除
            </button>
          </div>
        ))}
        <button
          type="button"
          className="self-start rounded border border-neutral-300 px-2 py-1 text-xs"
          onClick={addMeeting}
        >
          + 添加时段
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col text-xs text-neutral-500">
          容量
          <input
            type="number"
            className="rounded border border-neutral-300 px-2 py-1 text-sm"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        </label>
        <label className="flex flex-col text-xs text-neutral-500">
          默认上课地点
          <input
            className="rounded border border-neutral-300 px-2 py-1 text-sm"
            placeholder="教室 / 线下地址"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>
      </div>

      <label className="flex flex-col text-xs text-neutral-500">
        默认网课链接（Zoom / 腾讯会议）
        <input
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
          placeholder="https://…"
          value={meetingUrl}
          onChange={(e) => setMeetingUrl(e.target.value)}
        />
      </label>

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
          {isEdit ? '保存并重新生成课节' : '创建并生成课节'}
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
