'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createStudent, updateStudent, archiveStudent, type Student } from './actions'

export default function StudentForm({ student }: { student?: Student }) {
  const isEdit = Boolean(student)
  const [open, setOpen] = useState(!isEdit)
  const [name, setName] = useState(student?.name ?? '')
  const [parentWechat, setParentWechat] = useState(student?.parentWechat ?? '')
  const [schoolGrade, setSchoolGrade] = useState(student?.schoolGrade ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function submit() {
    setError(null)
    startTransition(async () => {
      try {
        // B29: create/update 现在返回判别式 {ok,error}（不再抛业务/校验错误）——按 res.ok 分支。
        if (isEdit && student) {
          const res = await updateStudent(student.id, { name, parentWechat, schoolGrade })
          if (!res.ok) {
            setError(res.error)
            return
          }
        } else {
          const res = await createStudent({ name, parentWechat, schoolGrade })
          if (!res.ok) {
            setError(res.error)
            return
          }
          setName('')
          setParentWechat('')
          setSchoolGrade('')
        }
        router.refresh()
        if (isEdit) setOpen(false)
      } catch (e) {
        // requireAuthContext/requirePermission 等框架级错误仍会抛——兜底提示。
        setError(e instanceof Error ? e.message : '保存失败')
      }
    })
  }

  function archive() {
    if (!student) return
    setError(null)
    startTransition(async () => {
      try {
        const res = await archiveStudent(student.id)
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
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-4 shadow-sm"
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <input
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
          placeholder="姓名"
          aria-label="姓名"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
          placeholder="家长微信"
          aria-label="家长微信"
          value={parentWechat}
          onChange={(e) => setParentWechat(e.target.value)}
        />
        <input
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
          placeholder="年级"
          aria-label="年级"
          value={schoolGrade}
          onChange={(e) => setSchoolGrade(e.target.value)}
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-neutral-900 px-3 py-1 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {isEdit ? '保存' : '添加学生'}
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
    </form>
  )
}
