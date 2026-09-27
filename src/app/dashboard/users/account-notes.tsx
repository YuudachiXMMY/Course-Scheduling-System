'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setUserNote } from './user-actions'
import { setStudentNotes } from '../students/actions'
import { ACCOUNT_NOTE_MAX } from '@/lib/note-schema'

// Unified admin-internal notes editor for every /dashboard/users tab. `target` discriminates where the note
// lives: a user row (家长/教师/管理员 → user.notes) or a student row (学生 → student.notes). Serializable props
// only, so RSC tabs can render it; each underlying Server Action re-checks its own authorization. The note
// is admin-only — it is never shown in any portal/self view.
export type NotesTarget = { kind: 'user'; id: string } | { kind: 'student'; id: string }

export default function AccountNotes({
  target,
  note,
}: {
  target: NotesTarget
  note: string | null
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const current = note?.trim() ?? ''

  function submit() {
    setError(null)
    startTransition(async () => {
      const res =
        target.kind === 'user'
          ? await setUserNote(target.id, value)
          : await setStudentNotes(target.id, value)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setOpen(false)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500">备注</span>
          <button
            type="button"
            className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50"
            onClick={() => {
              setValue(note ?? '') // re-seed from latest server value on open
              setError(null)
              setOpen(true)
            }}
          >
            {current ? '编辑备注' : '添加备注'}
          </button>
        </div>
        {current && (
          <p className="text-xs break-words whitespace-pre-wrap text-neutral-600">{current}</p>
        )}
      </div>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="flex flex-col gap-1"
    >
      <textarea
        className="w-full rounded border border-neutral-300 px-2 py-1 text-xs"
        placeholder="仅管理员可见的备注（选填）"
        aria-label="备注"
        rows={3}
        maxLength={ACCOUNT_NOTE_MAX}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="flex items-center gap-1">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-neutral-900 px-2 py-0.5 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {pending ? '保存中…' : '保存'}
        </button>
        <button
          type="button"
          disabled={pending}
          className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50"
          onClick={() => {
            setOpen(false)
            setError(null)
          }}
        >
          取消
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </form>
  )
}
