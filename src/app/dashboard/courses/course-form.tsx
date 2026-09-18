'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createCourse, updateCourse, archiveCourse, type Course } from './actions'

export default function CourseForm({
  course,
  alwaysOpen = false,
  onCreated,
}: {
  course?: Course
  // Workspace 设置 tab renders an edit form expanded (no 编辑 collapse trigger).
  alwaysOpen?: boolean
  // Rail create flow: report the new course so the caller can react (select/refresh).
  onCreated?: (course: Course) => void
}) {
  const isEdit = Boolean(course)
  const [open, setOpen] = useState(!isEdit || alwaysOpen)
  const [title, setTitle] = useState(course?.title ?? '')
  const [subject, setSubject] = useState(course?.subject ?? '')
  const [level, setLevel] = useState(course?.level ?? '')
  const [duration, setDuration] = useState(String(course?.defaultDurationMinutes ?? 60))
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  // B11: 本地表单态仅在挂载时从 props 取种子。父级以稳定 key（course.id）复用本组件跨 router.refresh()，
  // 同一课程的服务端数据变化（并发编辑 / 本次保存后回填）不会重挂载，陈旧本地态会静默覆盖新值。以
  // course.id + updatedAt 版本键在渲染期重置本地态（React 官方「随 prop 变化重置 state」写法，避免
  // effect 内同步 setState 触发级联渲染；纯本地重置，不触发 Server Action，故无刷新回环）。
  const courseVersion = `${course?.id ?? ''}:${course?.updatedAt?.getTime() ?? 0}`
  const [prevCourseVersion, setPrevCourseVersion] = useState(courseVersion)
  if (courseVersion !== prevCourseVersion) {
    setPrevCourseVersion(courseVersion)
    setTitle(course?.title ?? '')
    setSubject(course?.subject ?? '')
    setLevel(course?.level ?? '')
    setDuration(String(course?.defaultDurationMinutes ?? 60))
  }

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
        const result =
          isEdit && course ? await updateCourse(course.id, input) : await createCourse(input)
        if (!result.ok) {
          setError(result.error)
          return
        }
        if (!isEdit) {
          setTitle('')
          setSubject('')
          setLevel('')
          setDuration('60')
          if (result.ok) onCreated?.(result.course)
        }
        router.refresh()
        if (isEdit && !alwaysOpen) setOpen(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : '保存失败')
      }
    })
  }

  function archive() {
    if (!course) return
    setError(null)
    startTransition(async () => {
      // B10: archiveCourse 现返回 {ok,error}（见 actions.ts）。检查 res.ok 并 try/catch，避免越权
      // 点击时 FORBIDDEN 抛错静默失败——失败以组件内错误状态内联提示。
      try {
        const res = await archiveCourse(course.id)
        if (!res.ok) {
          setError(res.error)
          return
        }
        router.refresh()
        setOpen(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : '归档失败')
      }
    })
  }

  if (isEdit && !open) {
    return (
      <button
        type="button"
        className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50"
        onClick={() => setOpen(true)}
      >
        编辑
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-4 shadow-sm">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        {/* B13: 输入原本仅有 placeholder，无可访问名称。补 aria-label 满足 WCAG 1.3.1/3.3.2/4.1.2。 */}
        <input
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
          aria-label="课程名称"
          placeholder="课程名称（如 高一数学）"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
          aria-label="科目"
          placeholder="科目"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
        <input
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
          aria-label="级别"
          placeholder="级别"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
        />
        <input
          type="number"
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
          aria-label="默认时长（分钟）"
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
          className="rounded bg-neutral-900 px-3 py-1 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
          onClick={submit}
        >
          {isEdit ? '保存' : '添加课程'}
        </button>
        {isEdit && (
          <>
            <button
              type="button"
              disabled={pending}
              className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50"
              onClick={() => setOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              disabled={pending}
              className="rounded border border-red-300 px-3 py-1 text-xs text-red-600 hover:bg-red-50"
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
