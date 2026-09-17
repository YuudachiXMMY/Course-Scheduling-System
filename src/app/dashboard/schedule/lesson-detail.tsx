'use client'

import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  getLessonRoster,
  upsertAttendance,
  getLessonNotes,
  upsertSharedNote,
  upsertStudentNote,
  type RosterEntry,
} from './attendance-actions'
import { cancelLessonAction, updateLessonAction, getLessonMeta } from './actions'

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
  const [sharedNote, setSharedNote] = useState('')
  const [comments, setComments] = useState<Record<string, string>>({})
  const [location, setLocation] = useState('')
  const [meetingUrl, setMeetingUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  // B24：把详情抽屉升级为合规模态。panelRef 用于打开时把焦点移入 + 实现 Tab 焦点陷阱；
  // onClose 用 ref 引用最新值，让下方焦点 effect 只在挂载/卸载（= 打开/关闭）各跑一次。
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()

  // 每次渲染把最新的 onClose 同步进 ref，供下方"只挂载/卸载各跑一次"的焦点 effect 里的 Escape 读取，
  // 从而无需把 onClose 放进该 effect 的依赖（否则父组件每次重渲都会重新抢焦点）。
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // B24：进入时记录来源焦点并把焦点移入对话框；Escape 关闭；Tab / Shift+Tab 在对话框内循环，
  // 不逸出到背后页面；卸载（关闭）时把焦点归还给打开抽屉前的元素，形成完整的焦点管理闭环。
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    panel?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus()
    }
  }, [])

  useEffect(() => {
    let active = true
    Promise.all([
      getLessonRoster(lessonId),
      getLessonNotes(lessonId),
      getLessonMeta(lessonId),
    ]).then(([r, notes, meta]) => {
      if (!active) return
      setRoster(r)
      setSharedNote(notes.shared)
      setComments(notes.perStudent)
      setLocation(meta?.location ?? '')
      setMeetingUrl(meta?.meetingUrl ?? '')
      setLoading(false)
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

  function saveShared() {
    if (!sharedNote.trim()) {
      setMsg('笔记内容为空')
      return
    }
    startTransition(async () => {
      await upsertSharedNote({ lessonId, body: sharedNote })
      setMsg('已保存本节课笔记')
    })
  }

  function saveComment(studentId: string) {
    const body = comments[studentId] ?? ''
    if (!body.trim()) {
      setMsg('点评内容为空')
      return
    }
    startTransition(async () => {
      await upsertStudentNote({ lessonId, studentId, body })
      setMsg('已保存学生点评')
    })
  }

  function saveMeta() {
    startTransition(async () => {
      const res = await updateLessonAction({
        id: lessonId,
        location: location || undefined,
        meetingUrl: meetingUrl || undefined,
      })
      if (!res.ok) {
        setMsg(res.error)
        return
      }
      setMsg('已保存上课地点/网课链接')
      router.refresh()
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
    <div
      data-testid="lesson-detail-drawer"
      className="cs-enter-backdrop fixed inset-0 z-50 flex justify-end bg-black/30"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="cs-enter-panel flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto bg-white p-6 shadow-xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 id={titleId} className="text-base font-semibold">
            课节详情
          </h3>
          <button
            type="button"
            className="text-sm text-neutral-500 hover:text-neutral-900"
            onClick={onClose}
          >
            关闭
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-medium text-neutral-700">上课地点 / 网课链接</h4>
          <input
            aria-label="上课地点"
            className="rounded border border-neutral-300 px-2 py-1 text-sm"
            placeholder="上课地点（教室 / 线下地址）"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
          <input
            aria-label="网课链接"
            className="rounded border border-neutral-300 px-2 py-1 text-sm"
            placeholder="网课链接（Zoom / 腾讯会议）https://…"
            value={meetingUrl}
            onChange={(e) => setMeetingUrl(e.target.value)}
          />
          <button
            type="button"
            disabled={pending}
            className="self-start rounded bg-neutral-900 px-3 py-1 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
            onClick={saveMeta}
          >
            保存地点/链接
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
              data-testid="attendance-row"
              data-student-id={e.studentId}
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
                    className={`rounded px-2 py-1 text-xs ${
                      e.status === s.value
                        ? 'bg-neutral-900 text-white'
                        : 'border border-neutral-300 text-neutral-600 hover:bg-neutral-50'
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
          <h4 className="text-sm font-medium text-neutral-700">本节课笔记（全班共享）</h4>
          <textarea
            aria-label="本节课笔记（全班共享）"
            className="min-h-20 rounded border border-neutral-300 px-2 py-1 text-sm"
            placeholder="今天讲了…"
            value={sharedNote}
            onChange={(ev) => setSharedNote(ev.target.value)}
          />
          <button
            type="button"
            disabled={pending}
            className="self-start rounded bg-neutral-900 px-3 py-1 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
            onClick={saveShared}
          >
            保存笔记
          </button>
        </div>

        {!loading && roster.length > 0 && (
          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-medium text-neutral-700">学生点评（每人独立）</h4>
            {roster.map((e) => (
              <div key={e.studentId} className="flex flex-col gap-1">
                <span className="text-xs text-neutral-600">{e.name}</span>
                <textarea
                  aria-label={`给 ${e.name} 的本节课点评`}
                  className="min-h-14 rounded border border-neutral-300 px-2 py-1 text-sm"
                  placeholder={`给 ${e.name} 的本节课点评…`}
                  value={comments[e.studentId] ?? ''}
                  onChange={(ev) =>
                    setComments((prev) => ({ ...prev, [e.studentId]: ev.target.value }))
                  }
                />
                <button
                  type="button"
                  disabled={pending}
                  className="self-start rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
                  onClick={() => saveComment(e.studentId)}
                >
                  保存点评
                </button>
              </div>
            ))}
          </div>
        )}

        {msg && <p className="text-xs text-green-700">{msg}</p>}

        <div className="mt-auto flex gap-2 border-t border-neutral-200 pt-4">
          <button
            data-testid="lesson-cancel"
            type="button"
            disabled={pending}
            className="rounded border border-red-300 px-3 py-1 text-xs text-red-600 hover:bg-red-50"
            onClick={cancelOne}
          >
            取消这一节
          </button>
        </div>
      </div>
    </div>
  )
}
