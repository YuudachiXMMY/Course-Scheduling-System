'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { getLessonRoster, upsertAttendance, addNote, type RosterEntry } from './attendance-actions'
import { cancelLessonAction } from './actions'

type AttStatus = 'present' | 'absent' | 'late' | 'excused'
const STATUS_LABELS: { value: AttStatus; label: string }[] = [
  { value: 'present', label: '出勤' },
  { value: 'absent', label: '缺席' },
  { value: 'late', label: '迟到' },
  { value: 'excused', label: '请假' },
]

export default function LessonDetail({
  lessonId,
  onClose,
  onChanged,
}: {
  lessonId: string
  onClose: () => void
  onChanged: (lessonId: string) => void
}) {
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [noteBody, setNoteBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  useEffect(() => {
    let active = true
    getLessonRoster(lessonId).then((r) => {
      if (active) {
        setRoster(r)
        setLoading(false)
      }
    })
    return () => {
      active = false
    }
  }, [lessonId])

  function mark(studentId: string, status: AttStatus) {
    startTransition(async () => {
      await upsertAttendance({ lessonId, studentId, status })
      setRoster((prev) => prev.map((e) => (e.studentId === studentId ? { ...e, status } : e)))
      setMsg('已保存出勤')
    })
  }

  function saveNote() {
    if (!noteBody.trim()) return
    startTransition(async () => {
      await addNote({ lessonId, body: noteBody })
      setNoteBody('')
      setMsg('已保存笔记')
    })
  }

  function cancelOne() {
    startTransition(async () => {
      await cancelLessonAction(lessonId)
      onChanged(lessonId)
      router.refresh()
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">课节详情</h3>
          <button type="button" className="text-sm text-neutral-500" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-medium text-neutral-700">出勤</h4>
          {loading && <p className="text-xs text-neutral-500">加载中…</p>}
          {!loading && roster.length === 0 && (
            <p className="text-xs text-neutral-500">该班级暂无在读学生</p>
          )}
          {roster.map((e) => (
            <div
              key={e.studentId}
              className="flex items-center justify-between rounded border border-neutral-200 px-3 py-2"
            >
              <span className="text-sm">{e.name}</span>
              <div className="flex gap-1">
                {STATUS_LABELS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    disabled={pending}
                    onClick={() => mark(e.studentId, s.value)}
                    className={`rounded px-2 py-0.5 text-xs ${
                      e.status === s.value
                        ? 'bg-neutral-900 text-white'
                        : 'border border-neutral-300 text-neutral-600'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-medium text-neutral-700">课堂笔记</h4>
          <textarea
            className="min-h-20 rounded border border-neutral-300 px-2 py-1 text-sm"
            placeholder="今天讲了…"
            value={noteBody}
            onChange={(ev) => setNoteBody(ev.target.value)}
          />
          <button
            type="button"
            disabled={pending}
            className="self-start rounded bg-neutral-900 px-3 py-1 text-xs text-white disabled:opacity-50"
            onClick={saveNote}
          >
            保存笔记
          </button>
        </div>

        {msg && <p className="text-xs text-green-700">{msg}</p>}

        <div className="mt-auto flex gap-2 border-t border-neutral-200 pt-4">
          <button
            type="button"
            disabled={pending}
            className="rounded border border-red-300 px-3 py-1 text-xs text-red-600"
            onClick={cancelOne}
          >
            取消这一节
          </button>
        </div>
      </div>
    </div>
  )
}
