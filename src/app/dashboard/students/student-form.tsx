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
        if (isEdit && student) {
          await updateStudent(student.id, { name, parentWechat, schoolGrade })
        } else {
          await createStudent({ name, parentWechat, schoolGrade })
          setName('')
          setParentWechat('')
          setSchoolGrade('')
        }
        router.refresh()
        if (isEdit) setOpen(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : '保存失败')
      }
    })
  }

  function archive() {
    if (!student) return
    startTransition(async () => {
      await archiveStudent(student.id)
      router.refresh()
      setOpen(false)
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
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <input
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
          placeholder="姓名"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
          placeholder="家长微信"
          value={parentWechat}
          onChange={(e) => setParentWechat(e.target.value)}
        />
        <input
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
          placeholder="年级"
          value={schoolGrade}
          onChange={(e) => setSchoolGrade(e.target.value)}
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
    </div>
  )
}
