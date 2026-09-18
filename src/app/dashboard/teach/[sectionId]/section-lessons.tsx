'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { DateTime } from 'luxon'
import LessonDetail from '@/app/dashboard/schedule/lesson-detail'
import { rescheduleLessonAction } from '@/app/dashboard/schedule/actions'
import { materializeSectionAction } from '@/app/dashboard/courses/actions'
import { useFlash } from '@/app/dashboard/_components/use-flash'
import LessonNotesInline from './lesson-notes-inline'
import type { SectionLesson, SectionStudent, LessonNoteRow } from './data'
import { APP_TIME_ZONE } from '@/lib/timezone'

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

// 排课 tab body: date-grouped lesson list. A row opens the reused LessonDetail drawer (attendance /
// notes / cancel) verbatim; the 改期 control reschedules IN CONTEXT via rescheduleLessonAction — the
// same conflict pre-check + GiST backstop the calendar uses (staff hold lesson:update, so this is the
// direct primitive, not the portal request workflow). A soft CONFLICT returns as data → inline amber
// suggestions; a GiST-race throws (redacted in prod) → caught to a generic retry message.
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
  const [genError, setGenError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const { flash, show } = useFlash()
  const router = useRouter()

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

  function generate() {
    setGenError(null)
    startTransition(async () => {
      try {
        const res = await materializeSectionAction(sectionId)
        show(`已生成 ${res.inserted} 节课${res.conflicts ? `，${res.conflicts} 节因冲突跳过` : ''}`)
        router.refresh()
      } catch {
        // materializeSection re-throws genuine DB errors (non-exclusion) — surface, don't swallow.
        setGenError('生成课节失败，请重试')
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {canManage && (
            <button
              type="button"
              disabled={pending}
              onClick={generate}
              className="rounded bg-neutral-900 px-3 py-1 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              生成课节
            </button>
          )}
          {flash && (
            <span aria-live="polite" className="text-xs text-green-700">
              {flash}
            </span>
          )}
          {genError && (
            <span aria-live="polite" className="text-xs text-red-600">
              {genError}
            </span>
          )}
        </div>
        <a href="/dashboard/schedule" className="text-xs text-neutral-500 hover:text-neutral-900">
          在日历中查看 →
        </a>
      </div>

      {lessons.length === 0 && (
        <p className="rounded-lg border border-neutral-200 px-4 py-8 text-center text-sm text-neutral-500">
          本班级暂无课节。点击「生成课节」按上课时间批量生成。
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
                return (
                  <li key={l.id} className="flex flex-col gap-2 px-4 py-3 text-sm tabular-nums">
                    <div className="flex items-center justify-between gap-3">
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
                        initial={notes[l.id] ?? { summary: '', comments: {}, grades: {} }}
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
