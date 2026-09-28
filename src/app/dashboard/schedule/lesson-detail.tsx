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
  // 「对外开放」：共享笔记 visibility='shared'，对门户学生/家长可见。默认勾选（新笔记），加载后按 sharedVisibility 校正。
  const [shared, setShared] = useState(true)
  const [comments, setComments] = useState<Record<string, string>>({})
  const [location, setLocation] = useState('')
  const [meetingUrl, setMeetingUrl] = useState('')
  // 一键保存所有更改的脏检查基线：加载完成后记录各字段初值，saveAll 只提交与之不同的字段。
  const initialRef = useRef({
    sharedNote: '',
    comments: {} as Record<string, string>,
    location: '',
    meetingUrl: '',
    shared: true,
  })
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  // EH5：错误单独用 errorMsg 承载并以红色 role=alert 呈现，避免失败被渲染成绿色成功。
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
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
    Promise.all([getLessonRoster(lessonId), getLessonNotes(lessonId), getLessonMeta(lessonId)])
      .then(([r, notes, meta]) => {
        if (!active) return
        setRoster(r)
        setSharedNote(notes.shared)
        setShared(notes.sharedVisibility === 'shared')
        setComments(notes.perStudent)
        setLocation(meta?.location ?? '')
        setMeetingUrl(meta?.meetingUrl ?? '')
        initialRef.current = {
          sharedNote: notes.shared,
          comments: notes.perStudent,
          location: meta?.location ?? '',
          meetingUrl: meta?.meetingUrl ?? '',
          shared: notes.sharedVisibility === 'shared',
        }
        setLoading(false)
      })
      .catch((e) => {
        // F10: without this catch a rejected loader (e.g. an expired session throwing in the Server
        // Action) left the drawer spinning forever. Clear the spinner and surface the error instead.
        if (!active) return
        setLoading(false)
        setErrorMsg(e instanceof Error ? e.message : '加载失败')
      })
    return () => {
      active = false
    }
  }, [lessonId])

  // EH5：这些 handler 的 action 在鉴权/校验失败时会 throw；startTransition 会静默吞掉拒绝。
  // 用 try/catch 捕获并写入 errorMsg（红色 role=alert），成功才写 msg（绿色），二者互斥清空。
  function mark(studentId: string, status: AttStatus) {
    setMsg(null)
    setErrorMsg(null)
    startTransition(async () => {
      try {
        await upsertAttendance({ lessonId, studentId, status })
        setRoster((prev) => prev.map((e) => (e.studentId === studentId ? { ...e, status } : e)))
        setMsg('已保存出勤')
      } catch {
        // These actions THROW on failure; Next.js redacts thrown Server-Action messages in production
        // (React #441), so e.message would surface an English digest — show a Chinese fallback instead.
        setErrorMsg('记录考勤失败，请重试')
      }
    })
  }

  function saveShared() {
    setMsg(null)
    setErrorMsg(null)
    if (!sharedNote.trim()) {
      setErrorMsg('笔记内容为空')
      return
    }
    startTransition(async () => {
      try {
        await upsertSharedNote({
          lessonId,
          body: sharedNote,
          visibility: shared ? 'shared' : 'internal',
        })
        setMsg('已保存本节课笔记')
        initialRef.current = { ...initialRef.current, sharedNote, shared }
      } catch {
        setErrorMsg('保存笔记失败，请重试') // 见 mark() 注释：生产脱敏，避免展示英文摘要
      }
    })
  }

  // 一键保存所有更改：脏检查后只提交与加载基线不同的字段——上课地点/网课链接、共享笔记（含可见性）、
  // 逐生点评。出勤在抽屉内点击即时落库（见 mark），不纳入批量。清空 Summary/点评仍 out of scope（upsert
  // 需 body.min(1)）。updateLessonAction 返回 {ok,error} 而非 throw，故包一层在 !ok 时 throw，令 Promise.all
  // 的 catch 统一兜底。成功后刷新基线，避免重复点击重复写入。
  function saveAll() {
    setMsg(null)
    setErrorMsg(null)
    const init = initialRef.current
    const tasks: Promise<unknown>[] = []
    let saved = 0
    let skippedEmpty = 0

    if (location !== init.location || meetingUrl !== init.meetingUrl) {
      tasks.push(
        updateLessonAction({
          id: lessonId,
          location: location || undefined,
          meetingUrl: meetingUrl || undefined,
        }).then((res) => {
          if (!res.ok) throw new Error(res.error)
        }),
      )
      saved++
    }

    // 共享笔记：正文改动或「对外开放」开关被切换都需落库。visibility-only 的变更也要保存，否则翻动
    // 开关但没改正文时开关状态会丢失。upsert 需 body.min(1)，故仍要求正文非空。
    if (sharedNote !== init.sharedNote || shared !== init.shared) {
      if (sharedNote.trim()) {
        tasks.push(
          upsertSharedNote({
            lessonId,
            body: sharedNote,
            visibility: shared ? 'shared' : 'internal',
          }),
        )
        saved++
      } else {
        skippedEmpty++ // 清空 Summary out of scope
      }
    }

    for (const e of roster) {
      const body = comments[e.studentId] ?? ''
      const initialBody = init.comments[e.studentId] ?? ''
      if (body !== initialBody) {
        if (body.trim()) {
          tasks.push(upsertStudentNote({ lessonId, studentId: e.studentId, body }))
          saved++
        } else {
          skippedEmpty++ // 清空点评 out of scope
        }
      }
    }

    if (saved === 0) {
      setMsg(skippedEmpty > 0 ? '清空笔记/点评暂不支持保存' : '没有需要保存的更改')
      return
    }

    startTransition(async () => {
      try {
        await Promise.all(tasks)
        setMsg(
          skippedEmpty > 0
            ? `已保存全部更改（${saved} 项，清空的笔记/点评已跳过）`
            : `已保存全部更改（${saved} 项）`,
        )
        // 刷新基线为当前已落库值，避免二次点击重复写入。
        initialRef.current = { sharedNote, comments, location, meetingUrl, shared }
        router.refresh()
      } catch {
        setErrorMsg('部分更改保存失败，请重试') // 见 mark() 注释：生产脱敏
        router.refresh()
      }
    })
  }

  function saveComment(studentId: string) {
    setMsg(null)
    setErrorMsg(null)
    const body = comments[studentId] ?? ''
    if (!body.trim()) {
      setErrorMsg('点评内容为空')
      return
    }
    startTransition(async () => {
      try {
        await upsertStudentNote({ lessonId, studentId, body })
        setMsg('已保存学生点评')
        // 刷新该生的脏检查基线，避免随后「一键保存所有更改」把已保存的点评重复提交（见 saveShared）。
        initialRef.current = {
          ...initialRef.current,
          comments: { ...initialRef.current.comments, [studentId]: body },
        }
      } catch {
        setErrorMsg('保存点评失败，请重试') // 见 mark() 注释：生产脱敏，避免展示英文摘要
      }
    })
  }

  function saveMeta() {
    setMsg(null)
    setErrorMsg(null)
    startTransition(async () => {
      const res = await updateLessonAction({
        id: lessonId,
        location: location || undefined,
        meetingUrl: meetingUrl || undefined,
      })
      if (!res.ok) {
        setErrorMsg(res.error)
        return
      }
      setMsg('已保存上课地点/网课链接')
      // 刷新地点/链接的脏检查基线，避免随后「一键保存所有更改」重复提交已保存值（见 saveShared）。
      initialRef.current = { ...initialRef.current, location, meetingUrl }
      router.refresh()
    })
  }

  function cancelOne() {
    setMsg(null)
    setErrorMsg(null)
    startTransition(async () => {
      try {
        await cancelLessonAction(lessonId)
        onChanged(lessonId)
        router.refresh()
        onClose()
      } catch {
        setErrorMsg('取消失败，请重试') // 见 mark() 注释：生产脱敏，避免展示英文摘要
      }
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
                    aria-pressed={e.status === s.value}
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
          <h4 className="text-sm font-medium text-neutral-700">本节课笔记（全班共享 · Summary）</h4>
          <textarea
            aria-label="本节课笔记（全班共享）"
            className="min-h-20 rounded border border-neutral-300 px-2 py-1 text-sm"
            placeholder="今天讲了…"
            value={sharedNote}
            onChange={(ev) => setSharedNote(ev.target.value)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={pending}
              className="rounded bg-neutral-900 px-3 py-1 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
              onClick={saveShared}
            >
              保存笔记
            </button>
            {/* 逐条「对外开放」：勾选后该课节笔记 visibility='shared'，门户的关联学生/家长可见。新笔记默认勾选。 */}
            <label className="flex items-center gap-1.5 text-xs text-neutral-600">
              <input
                type="checkbox"
                checked={shared}
                disabled={pending}
                onChange={(e) => setShared(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              对外开放（学生 / 家长可见）
            </label>
          </div>
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

        {msg && (
          <p aria-live="polite" className="text-xs text-green-700">
            {msg}
          </p>
        )}
        {errorMsg && (
          <p role="alert" className="text-xs text-red-600">
            {errorMsg}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-neutral-200 pt-4">
          <button
            data-testid="lesson-cancel"
            type="button"
            disabled={pending}
            className="rounded border border-red-300 px-3 py-1 text-xs text-red-600 hover:bg-red-50"
            onClick={cancelOne}
          >
            取消这一节
          </button>
          <button
            type="button"
            disabled={pending || loading}
            className="rounded bg-neutral-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            onClick={saveAll}
          >
            一键保存所有更改
          </button>
        </div>
      </div>
    </div>
  )
}
