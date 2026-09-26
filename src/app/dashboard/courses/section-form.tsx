'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  createSection,
  updateSection,
  materializeSectionAction,
  type ClassSection,
} from './actions'
import { APP_TIME_ZONE } from '@/lib/timezone'
import type { Weekday } from '@/lib/rrule-build'
import type { TeacherOption } from './data'

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
  // 稳定的本地行标识，用作 React key：时段列表可新增/删除，用数组下标作 key 在删除中间行时会错位
  // （受控输入与本地状态串位）。稳定 key 让 React 精确复用/卸载对应行。
  key: string
  byDay: Weekday
  startTime: string
  durationMinutes: string
}

function toDateInput(d: Date | null): string {
  return d ? new Date(d).toISOString().slice(0, 10) : ''
}

// 单调递增计数器生成时段行 key。仅在客户端交互（新增时段 / 加载已有时段）中调用；初始行用固定 key。
let meetingRowSeq = 0
const nextMeetingKey = () => `mr-${meetingRowSeq++}`

export default function SectionForm({
  courseId,
  defaultTeacherId,
  section,
  embedded = false,
  onCreated,
  teachers = [],
  canAssignTeacher = false,
}: {
  courseId: string
  defaultTeacherId: string
  section?: ClassSection
  // Workspace: render always-open (settings tab / rail create), no collapse trigger.
  embedded?: boolean
  // Rail create flow: report the new section id so the caller can navigate to it.
  onCreated?: (sectionId: string) => void
  // CR2: whole-tenant admins may assign a section to another org teacher. section-scoped teachers get
  // no picker and are forced to themselves (server re-enforces this via B8). Optional — call sites that
  // don't pass these (teach workspace) keep the self-only behavior.
  teachers?: TeacherOption[]
  canAssignTeacher?: boolean
}) {
  const isEdit = Boolean(section)
  const [open, setOpen] = useState(Boolean(embedded))
  const [name, setName] = useState(section?.name ?? '')
  const [meetings, setMeetings] = useState<MeetingRow[]>([
    { key: 'mr-initial', byDay: 'MO', startTime: '16:00', durationMinutes: '60' },
  ])
  const [capacity, setCapacity] = useState(String(section?.capacity ?? 1))
  const [termStart, setTermStart] = useState(toDateInput(section?.termStartDate ?? null))
  const [termEnd, setTermEnd] = useState(toDateInput(section?.termEndDate ?? null))
  const [location, setLocation] = useState(section?.defaultLocation ?? '')
  const [meetingUrl, setMeetingUrl] = useState(section?.defaultMeetingUrl ?? '')
  // CR2: which teacher the created section belongs to. Only meaningful on create — updateSection strips
  // teacherId (H1), so the picker is shown for create only. Defaults to the acting user (defaultTeacherId).
  const [teacherId, setTeacherId] = useState(defaultTeacherId)
  const showTeacherPicker = canAssignTeacher && !isEdit && teachers.length > 0
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  // 上课时段 is INITIALIZATION-only: the editor renders on CREATE only, so edit mode no longer loads
  // the existing meeting slots. After creation, sessions are managed under 排课 (添加课节 / 多选删除).

  // B12: 标量字段仅在挂载时取种子。父级以稳定 key（section.id）复用本组件跨 router.refresh()，同一
  // 班级的服务端数据变化（并发编辑 / 本次保存后回填）不会重挂载 → 陈旧本地态静默覆盖新值。以 id +
  // updatedAt 版本键在渲染期重置标量字段（React 官方「随 prop 变化重置 state」写法，避免 effect 内同步
  // setState）。meetings 不在此重置 —— 它只用于 CREATE，编辑态不再渲染时段编辑器。
  const sectionVersion = `${section?.id ?? ''}:${section?.updatedAt?.getTime() ?? 0}`
  const [prevSectionVersion, setPrevSectionVersion] = useState(sectionVersion)
  if (sectionVersion !== prevSectionVersion) {
    setPrevSectionVersion(sectionVersion)
    setName(section?.name ?? '')
    setCapacity(String(section?.capacity ?? 1))
    setTermStart(toDateInput(section?.termStartDate ?? null))
    setTermEnd(toDateInput(section?.termEndDate ?? null))
    setLocation(section?.defaultLocation ?? '')
    setMeetingUrl(section?.defaultMeetingUrl ?? '')
  }

  function updateMeeting(i: number, patch: Partial<MeetingRow>) {
    setMeetings((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)))
  }
  function addMeeting() {
    setMeetings((prev) => [
      ...prev,
      { key: nextMeetingKey(), byDay: 'MO', startTime: '16:00', durationMinutes: '60' },
    ])
  }
  function removeMeeting(i: number) {
    setMeetings((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)))
  }

  function submit() {
    setError(null)
    setStatus(null)
    // Client-side validation: in production, server-side ZodError messages are redacted by Next.js
    // and surface as the cryptic "Minified React error #441". Fail fast here with clear feedback.
    // 上课时段 is required only on CREATE — the edit form doesn't render it.
    if (!isEdit && meetings.length === 0) {
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

    // EDIT: 上课时段 is initialization-only, so editing never rewrites the recurrence grid nor re-
    // materializes lessons. Update only the scalar fields; sessions are added/removed under 排课.
    if (isEdit && section) {
      const editPayload = {
        name: name || undefined,
        capacity: Number(capacity),
        termStartDate: termStart,
        termEndDate: termEnd || undefined,
        timezone: APP_TIME_ZONE,
        defaultLocation: location || undefined,
        defaultMeetingUrl: meetingUrl || undefined,
      }
      startTransition(async () => {
        try {
          const result = await updateSection(section.id, editPayload)
          if (!result.ok) {
            setError(result.error)
            return
          }
          setStatus('已保存')
          router.refresh()
          if (!embedded) setOpen(false)
        } catch (e) {
          setError(e instanceof Error ? e.message : '保存失败')
        }
      })
      return
    }

    // CREATE: seed the sectionMeeting grid from 上课时段 and materialize the initial lessons.
    const payload = {
      courseId,
      name: name || undefined,
      // CR2: send the picked teacher on create (whole-tenant admin); otherwise the acting user. The
      // server forces a section-scoped teacher to self and verifies org membership regardless (B8).
      teacherId: showTeacherPicker ? teacherId : defaultTeacherId,
      capacity: Number(capacity),
      meetings: meetings.map((m) => ({
        byDay: m.byDay,
        startTime: m.startTime,
        durationMinutes: Number(m.durationMinutes),
      })),
      termStartDate: termStart,
      termEndDate: termEnd || undefined,
      timezone: APP_TIME_ZONE,
      defaultLocation: location || undefined,
      defaultMeetingUrl: meetingUrl || undefined,
    }
    startTransition(async () => {
      try {
        const result = await createSection(payload)
        if (!result.ok) {
          setError(result.error)
          return
        }
        const res = await materializeSectionAction(result.section.id)
        setStatus(
          `已生成 ${res.inserted} 节课${res.conflicts ? `，${res.conflicts} 节因冲突跳过` : ''}`,
        )
        router.refresh()
        onCreated?.(result.section.id)
      } catch (e) {
        setError(e instanceof Error ? e.message : '保存失败')
      }
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100"
        onClick={() => setOpen(true)}
      >
        {isEdit ? '编辑' : '+ 新建班级'}
      </button>
    )
  }

  return (
    <div className="flex w-full flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 shadow-sm">
      {/* B14: 输入补可访问名称（WCAG 1.3.1/3.3.2/4.1.2）。 */}
      <input
        className="rounded border border-neutral-300 px-2 py-1 text-sm"
        aria-label="班级名称"
        placeholder="班级名称（如 周一班）"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      {/* CR2: whole-tenant admins choose which teacher the new section belongs to. */}
      {showTeacherPicker && (
        <label className="flex flex-col text-xs text-neutral-500">
          授课教师
          <select
            className="rounded border border-neutral-300 px-2 py-1 text-sm"
            aria-label="授课教师"
            value={teacherId}
            onChange={(e) => setTeacherId(e.target.value)}
          >
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {isEdit && (
        <p className="rounded border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-400">
          上课时段仅在创建班级时设置；如需增减课节，请到「排课」使用「添加课节 / 选择删除」。
        </p>
      )}

      {!isEdit && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">上课时段（可添加多个不同日期/时间）</span>
          {meetings.map((m, i) => {
            // B14: 逐行控件用含行序号 + 星期的动态标签，让屏幕阅读器区分这是哪一行。
            const dayLabel = WEEKDAY_LABELS.find((d) => d.value === m.byDay)?.label ?? ''
            const rowLabel = `第 ${i + 1} 个时段（${dayLabel}）`
            return (
              // MEDIUM: 用稳定的 m.key（非数组下标）作 React key。
              <div key={m.key} className="flex flex-wrap items-center gap-2">
                <select
                  className="rounded border border-neutral-300 px-2 py-1 text-sm"
                  aria-label={`${rowLabel} · 星期`}
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
                  aria-label={`${rowLabel} · 开始时间`}
                  value={m.startTime}
                  onChange={(e) => updateMeeting(i, { startTime: e.target.value })}
                />
                <input
                  type="number"
                  className="w-24 rounded border border-neutral-300 px-2 py-1 text-sm"
                  aria-label={`${rowLabel} · 时长（分钟）`}
                  placeholder="时长(分)"
                  value={m.durationMinutes}
                  onChange={(e) => updateMeeting(i, { durationMinutes: e.target.value })}
                />
                <button
                  type="button"
                  disabled={meetings.length <= 1}
                  aria-label={`删除${rowLabel}`}
                  className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
                  onClick={() => removeMeeting(i)}
                >
                  删除
                </button>
              </div>
            )
          })}
          <button
            type="button"
            className="self-start rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100"
            onClick={addMeeting}
          >
            + 添加时段
          </button>
        </div>
      )}

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
          className="rounded bg-neutral-900 px-3 py-1 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
          onClick={submit}
        >
          {isEdit ? '保存' : '创建并生成课节'}
        </button>
        <button
          type="button"
          className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100"
          onClick={() => setOpen(false)}
        >
          取消
        </button>
      </div>
    </div>
  )
}
