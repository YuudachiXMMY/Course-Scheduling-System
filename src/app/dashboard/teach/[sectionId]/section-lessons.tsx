'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { DateTime } from 'luxon'
import LessonDetail from '@/app/dashboard/schedule/lesson-detail'
import {
  rescheduleLessonAction,
  addSessionsAction,
  cancelLessonsAction,
} from '@/app/dashboard/schedule/actions'
import InlineConfirm from '@/app/dashboard/_components/inline-confirm'
import { useFlash } from '@/app/dashboard/_components/use-flash'
import LessonNotesInline from './lesson-notes-inline'
import type { SectionLesson, SectionStudent, LessonNoteRow } from './data'
import { APP_TIME_ZONE } from '@/lib/timezone'
import { WEEKDAYS, type Weekday, type RecurrenceFreq } from '@/lib/rrule-build'

const ZONE = APP_TIME_ZONE
const fmtTime = (iso: string) =>
  DateTime.fromISO(iso, { zone: 'utc' }).setZone(ZONE).toFormat('HH:mm')
const fmtDay = (iso: string) => {
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(ZONE)
  return `${dt.toFormat('MM月dd日')} 周${'一二三四五六日'[dt.weekday - 1]}`
}
const toLocalInput = (iso: string) =>
  DateTime.fromISO(iso, { zone: 'utc' }).setZone(ZONE).toFormat("yyyy-MM-dd'T'HH:mm")

interface ConflictInfo {
  conflicts: { id: string; title: string | null }[]
  suggestions: string[]
}

const FREQ_OPTIONS: { value: RecurrenceFreq; label: string }[] = [
  { value: 'DAILY', label: '每天' },
  { value: 'WEEKLY', label: '每周' },
  { value: 'BIWEEKLY', label: '每两周' },
  { value: 'MONTHLY', label: '每月' },
]
const WEEKDAY_LABELS: Record<Weekday, string> = {
  MO: '周一',
  TU: '周二',
  WE: '周三',
  TH: '周四',
  FR: '周五',
  SA: '周六',
  SU: '周日',
}

// 排课 tab body: date-grouped lesson list. A row opens the reused LessonDetail drawer (attendance /
// notes / cancel) verbatim; the 改期 control reschedules IN CONTEXT via rescheduleLessonAction — the
// same conflict pre-check + GiST backstop the calendar uses (staff hold lesson:update, so this is the
// direct primitive, not the portal request workflow). A soft CONFLICT returns as data → inline amber
// suggestions; a GiST-race throws (redacted in prod) → caught to a generic retry message.
//
// 上课时段 is INITIALIZATION-only (seeds the grid once at section creation). After that, sessions are
// managed HERE: 添加课节 expands a recurrence over a date range (addSessionsAction), and 选择删除 bulk-
// cancels the checked future lessons (cancelLessonsAction, soft-delete tombstone).
export default function SectionLessons({
  sectionId,
  lessons,
  roster,
  notes,
  canManage,
}: {
  sectionId: string
  lessons: SectionLesson[]
  roster: SectionStudent[]
  notes: Record<string, LessonNoteRow>
  canManage: boolean
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [notesOpenId, setNotesOpenId] = useState<string | null>(null)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [conflicts, setConflicts] = useState<Record<string, ConflictInfo>>({})
  const [pending, startTransition] = useTransition()
  const { flash, show } = useFlash()
  const router = useRouter()

  // 添加课节 form state.
  const [showAdd, setShowAdd] = useState(false)
  const [freq, setFreq] = useState<RecurrenceFreq>('WEEKLY')
  const [byDays, setByDays] = useState<Set<Weekday>>(new Set(['MO']))
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [addTime, setAddTime] = useState('16:00')
  const [addDuration, setAddDuration] = useState('60')
  const [addError, setAddError] = useState<string | null>(null)

  // 多选删除 state.
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleteError, setDeleteError] = useState<string | null>(null)

  function clearRow(id: string) {
    setErrors((e) => ({ ...e, [id]: '' }))
    setConflicts((c) => {
      const n = { ...c }
      delete n[id]
      return n
    })
  }

  function beginEdit(l: SectionLesson) {
    setEditId(l.id)
    setStart(toLocalInput(l.start))
    setEnd(toLocalInput(l.end))
    clearRow(l.id)
  }

  function submitReschedule(id: string) {
    if (!start || !end) {
      setErrors((e) => ({ ...e, [id]: '请选择开始与结束时间' }))
      return
    }
    clearRow(id)
    startTransition(async () => {
      try {
        const startAt = DateTime.fromISO(start, { zone: ZONE }).toUTC().toJSDate()
        const endAt = DateTime.fromISO(end, { zone: ZONE }).toUTC().toJSDate()
        const res = await rescheduleLessonAction({ id, startAt, endAt })
        if (res.ok) {
          setEditId(null)
          show('已改期')
          router.refresh()
          return
        }
        setConflicts((c) => ({
          ...c,
          [id]: { conflicts: res.conflicts, suggestions: res.suggestions },
        }))
      } catch {
        setErrors((e) => ({ ...e, [id]: '改期失败，请重试' }))
      }
    })
  }

  function toggleByDay(d: Weekday) {
    setByDays((prev) => {
      const n = new Set(prev)
      if (n.has(d)) n.delete(d)
      else n.add(d)
      return n
    })
  }

  function addSessions() {
    setAddError(null)
    if (!fromDate || !toDate) {
      setAddError('请选择起止日期')
      return
    }
    if (toDate < fromDate) {
      setAddError('结束日期不能早于开始日期')
      return
    }
    const needsDays = freq === 'WEEKLY' || freq === 'BIWEEKLY'
    if (needsDays && byDays.size === 0) {
      setAddError('请至少选择一个星期几')
      return
    }
    startTransition(async () => {
      try {
        const res = await addSessionsAction({
          sectionId,
          freq,
          byDays: needsDays ? [...byDays] : undefined,
          startDate: fromDate,
          endDate: toDate,
          startTime: addTime,
          durationMinutes: Number(addDuration),
        })
        if (!res.ok) {
          setAddError(res.error)
          return
        }
        show(`已添加 ${res.inserted} 节课${res.conflicts ? `，${res.conflicts} 节因冲突跳过` : ''}`)
        setShowAdd(false)
        router.refresh()
      } catch (e) {
        // Log the underlying failure (expired session / transient network) so it's diagnosable; the user
        // still only sees the generic retry message.
        console.error('addSessionsAction failed', e)
        setAddError('添加课节失败，请重试')
      }
    })
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelected(new Set())
    setDeleteError(null)
  }

  function deleteSelected() {
    if (selected.size === 0) return
    setDeleteError(null)
    startTransition(async () => {
      try {
        const res = await cancelLessonsAction([...selected])
        if (!res.ok) {
          setDeleteError(res.error)
          return
        }
        show(`已删除 ${res.canceled} 节课`)
        exitSelectMode()
        router.refresh()
      } catch (e) {
        // Log the underlying failure so it's diagnosable; the user still only sees the generic message.
        console.error('cancelLessonsAction failed', e)
        setDeleteError('删除失败，请重试')
      }
    })
  }

  const groups: { day: string; items: SectionLesson[] }[] = []
  for (const l of lessons) {
    const day = fmtDay(l.start)
    const g = groups.find((x) => x.day === day)
    if (g) g.items.push(l)
    else groups.push({ day, items: [l] })
  }

  const needsDays = freq === 'WEEKLY' || freq === 'BIWEEKLY'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {canManage && (
            <>
              <button
                type="button"
                aria-expanded={showAdd}
                disabled={pending}
                onClick={() => setShowAdd((v) => !v)}
                className="rounded bg-neutral-900 px-3 py-1 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                添加课节
              </button>
              {!selectMode ? (
                <button
                  type="button"
                  disabled={pending || lessons.length === 0}
                  onClick={() => setSelectMode(true)}
                  className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
                >
                  选择删除
                </button>
              ) : (
                <>
                  <InlineConfirm
                    danger
                    label={`删除所选（${selected.size}）`}
                    confirmLabel="确认删除"
                    disabled={pending || selected.size === 0}
                    onConfirm={deleteSelected}
                  />
                  <button
                    type="button"
                    onClick={exitSelectMode}
                    className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50"
                  >
                    取消选择
                  </button>
                </>
              )}
            </>
          )}
          {flash && (
            <span aria-live="polite" className="text-xs text-green-700">
              {flash}
            </span>
          )}
          {deleteError && (
            <span aria-live="polite" className="text-xs text-red-600">
              {deleteError}
            </span>
          )}
        </div>
        <a href="/dashboard/schedule" className="text-xs text-neutral-500 hover:text-neutral-900">
          在日历中查看 →
        </a>
      </div>

      {canManage && showAdd && (
        <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1">
              <span className="text-xs text-neutral-500">重复</span>
              <select
                aria-label="重复方式"
                className="rounded border border-neutral-300 px-2 py-1 text-sm"
                value={freq}
                onChange={(e) => setFreq(e.target.value as typeof freq)}
              >
                {FREQ_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1">
              <span className="text-xs text-neutral-500">开始时间</span>
              <input
                type="time"
                aria-label="开始时间"
                className="rounded border border-neutral-300 px-2 py-1 text-sm"
                value={addTime}
                onChange={(e) => setAddTime(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-1">
              <span className="text-xs text-neutral-500">时长</span>
              <input
                type="number"
                aria-label="时长（分钟）"
                className="w-20 rounded border border-neutral-300 px-2 py-1 text-sm"
                value={addDuration}
                onChange={(e) => setAddDuration(e.target.value)}
              />
              <span className="text-xs text-neutral-400">分钟</span>
            </label>
          </div>

          {needsDays && (
            <fieldset className="flex flex-wrap items-center gap-2">
              <legend className="sr-only">选择星期几</legend>
              <span className="text-xs text-neutral-500">星期</span>
              {WEEKDAYS.map((d) => {
                const on = byDays.has(d)
                return (
                  <label
                    key={d}
                    className={`cursor-pointer rounded border px-2 py-1 text-xs ${
                      on
                        ? 'border-neutral-900 bg-neutral-900 text-white'
                        : 'border-neutral-300 text-neutral-700 hover:bg-neutral-100'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={on}
                      onChange={() => toggleByDay(d)}
                    />
                    {WEEKDAY_LABELS[d]}
                  </label>
                )
              })}
            </fieldset>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1">
              <span className="text-xs text-neutral-500">从</span>
              <input
                type="date"
                aria-label="开始日期"
                className="rounded border border-neutral-300 px-2 py-1 text-sm"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-1">
              <span className="text-xs text-neutral-500">至</span>
              <input
                type="date"
                aria-label="结束日期"
                className="rounded border border-neutral-300 px-2 py-1 text-sm"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={pending}
              onClick={addSessions}
              className="rounded bg-neutral-900 px-3 py-1 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              确认添加
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAdd(false)
                setAddError(null)
              }}
              className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50"
            >
              取消
            </button>
          </div>
          {addError && <p className="text-xs text-red-600">{addError}</p>}
        </div>
      )}

      {lessons.length === 0 && (
        <p className="rounded-lg border border-neutral-200 px-4 py-8 text-center text-sm text-neutral-500">
          本班级暂无课节。点击「添加课节」按重复规则批量添加。
        </p>
      )}

      <ul className="flex flex-col gap-4">
        {groups.map((g) => (
          <li key={g.day} className="flex flex-col gap-1">
            <div className="text-xs font-medium tracking-wide text-neutral-500 tabular-nums">
              {g.day}
            </div>
            <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
              {g.items.map((l) => {
                const past = l.isPast
                const conflict = conflicts[l.id]
                // Only future lessons are selectable for bulk delete — past/attended lessons keep
                // their history and are never bulk-canceled by accident.
                const selectable = selectMode && !past
                return (
                  <li key={l.id} className="flex flex-col gap-2 px-4 py-3 text-sm tabular-nums">
                    <div className="flex items-center justify-between gap-3">
                      {selectable && (
                        <input
                          type="checkbox"
                          className="mr-1 shrink-0"
                          aria-label={`选择 ${fmtTime(l.start)} ${l.title}`}
                          checked={selected.has(l.id)}
                          onChange={() => toggleSelect(l.id)}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => setOpenId(l.id)}
                        className="flex flex-1 items-center gap-2 overflow-hidden text-left hover:text-neutral-900"
                      >
                        <span className={past ? 'shrink-0 text-neutral-400' : 'shrink-0'}>
                          {fmtTime(l.start)}–{fmtTime(l.end)}
                        </span>
                        <span className="truncate">{l.title}</span>
                        <span className="shrink-0 text-xs text-neutral-400">
                          {l.location ?? (l.meetingUrl ? '线上' : '—')}
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          aria-expanded={notesOpenId === l.id}
                          onClick={() => setNotesOpenId(notesOpenId === l.id ? null : l.id)}
                          className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50"
                        >
                          {notesOpenId === l.id ? '笔记点评 ▲' : '笔记点评 ▼'}
                        </button>
                        {canManage && (
                          // B33: 改期是披露按钮（切换下方改期表单），补 aria-expanded/aria-controls，
                          // 与相邻「笔记点评」披露按钮一致（后者已带 aria-expanded）。
                          <button
                            type="button"
                            aria-expanded={editId === l.id}
                            aria-controls={`reschedule-${l.id}`}
                            onClick={() => (editId === l.id ? setEditId(null) : beginEdit(l))}
                            className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50"
                          >
                            改期
                          </button>
                        )}
                      </div>
                    </div>

                    {editId === l.id && (
                      <div
                        id={`reschedule-${l.id}`}
                        className="flex flex-wrap items-center gap-2 rounded border border-neutral-200 bg-neutral-50 p-2"
                      >
                        <input
                          type="datetime-local"
                          value={start}
                          onChange={(e) => setStart(e.target.value)}
                          className="rounded border border-neutral-300 px-2 py-1 text-xs"
                        />
                        <span className="text-xs text-neutral-400">至</span>
                        <input
                          type="datetime-local"
                          value={end}
                          onChange={(e) => setEnd(e.target.value)}
                          className="rounded border border-neutral-300 px-2 py-1 text-xs"
                        />
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => submitReschedule(l.id)}
                          className="rounded bg-neutral-900 px-3 py-1 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
                        >
                          确认改期
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditId(null)}
                          className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50"
                        >
                          取消
                        </button>
                      </div>
                    )}

                    {errors[l.id] && <p className="text-xs text-red-600">{errors[l.id]}</p>}
                    {conflict && (
                      <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                        <p>该时段与已有课节冲突，未改期：</p>
                        {conflict.conflicts.length > 0 && (
                          <p className="mt-1">
                            冲突：{conflict.conflicts.map((c) => c.title ?? '课节').join('、')}
                          </p>
                        )}
                        {conflict.suggestions.length > 0 && (
                          <p className="mt-1">建议时段：{conflict.suggestions.join('、')}</p>
                        )}
                      </div>
                    )}

                    {notesOpenId === l.id && (
                      <LessonNotesInline
                        lessonId={l.id}
                        roster={roster}
                        initial={
                          notes[l.id] ?? {
                            summary: '',
                            // 与 getSectionLessonNotes 的「无笔记默认 shared」种子保持一致（见 data.ts）。
                            // 实际上 getSectionLessonNotes 会为每个 lessonId 填充 byLesson，此 ?? 兜底不可达，
                            // 仅作防御；保持同一默认避免语义漂移。
                            summaryVisibility: 'shared',
                            comments: {},
                            grades: {},
                            attendance: {},
                          }
                        }
                        canManage={canManage}
                      />
                    )}
                  </li>
                )
              })}
            </ul>
          </li>
        ))}
      </ul>

      {openId && (
        <LessonDetail
          lessonId={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  )
}
