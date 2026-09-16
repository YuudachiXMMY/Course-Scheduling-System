'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { upsertSharedNote, upsertStudentNote } from '@/app/dashboard/schedule/attendance-actions'
import { upsertLessonStudentGrade } from './grade-actions'
import { useFlash } from '@/app/dashboard/_components/use-flash'
import type { SectionStudent, LessonNoteRow } from './data'

// Inline (排课 tab) editor for ONE lesson: the shared Summary note (全班共享) plus, per rostered
// student, a 点评 (note) and an optional 成绩 (grade). Controlled local state seeded from server data +
// useTransition + per-cell save + green flash. State is seeded from the `initial` prop via useState
// initializers, which run only on mount — so after a save we router.refresh() to re-run the RSC and
// refresh the parent's `notes` prop. Without it, the reused note actions only revalidate
// '/dashboard/schedule' (not this teach path), and collapsing + re-expanding the editor would re-seed
// from the frozen page-load value, making a saved edit appear lost (it was persisted). This mirrors
// section-lessons.tsx's submitReschedule/generate, which also refresh after a mutation.
export default function LessonNotesInline({
  lessonId,
  roster,
  initial,
  canManage,
}: {
  lessonId: string
  roster: SectionStudent[]
  initial: LessonNoteRow
  canManage: boolean
}) {
  const [summary, setSummary] = useState(() => initial.summary)
  const [comments, setComments] = useState<Record<string, string>>(() => ({ ...initial.comments }))
  const [grades, setGrades] = useState<Record<string, { score: string; maxScore: string }>>(() => {
    const m: Record<string, { score: string; maxScore: string }> = {}
    for (const [sid, cell] of Object.entries(initial.grades)) {
      m[sid] = { score: cell.score ?? '', maxScore: cell.maxScore ?? '' }
    }
    return m
  })
  const [pending, startTransition] = useTransition()
  const { flash, show } = useFlash()
  const router = useRouter()

  function saveSummary() {
    if (!summary.trim()) {
      show('笔记内容为空')
      return
    }
    startTransition(async () => {
      await upsertSharedNote({ lessonId, body: summary })
      show('已保存本节课笔记')
      router.refresh()
    })
  }

  function saveComment(studentId: string) {
    // upsertStudentNote requires body.min(1); clearing a 点评 is out of scope (see plan NOT Building).
    const body = comments[studentId] ?? ''
    if (!body.trim()) {
      show('点评内容为空')
      return
    }
    startTransition(async () => {
      await upsertStudentNote({ lessonId, studentId, body })
      show('已保存点评')
      router.refresh()
    })
  }

  function setGradeField(studentId: string, field: 'score' | 'maxScore', value: string) {
    setGrades((prev) => {
      const cell = prev[studentId] ?? { score: '', maxScore: '' }
      return { ...prev, [studentId]: { ...cell, [field]: value } }
    })
  }

  function saveGrade(studentId: string) {
    const cell = grades[studentId] ?? { score: '', maxScore: '' }
    // Empty string must become undefined: z.coerce.number('') is 0, which would store a real 0 instead
    // of deleting the row. undefined stays undefined under z.coerce.number().optional().
    const score = cell.score.trim() === '' ? undefined : cell.score
    const maxScore = cell.maxScore.trim() === '' ? undefined : cell.maxScore
    startTransition(async () => {
      await upsertLessonStudentGrade({ lessonId, studentId, score, maxScore })
      show(score == null && maxScore == null ? '已清除成绩' : '已保存成绩')
      router.refresh()
    })
  }

  // 一键保存本节课的所有更改：脏检查后只提交与 `initial` 不同的字段，避免无谓写入，也避免触发
  // upsertSharedNote / upsertStudentNote 的 body.min(1) 校验（清空 Summary/点评 仍然 out of scope，
  // 见 saveComment）。成绩沿用 saveGrade 的空串→undefined 规则，所以清空成绩会作为一次更改被删除。
  // 全部 await Promise.all 后只 show 一次汇总并 router.refresh() 一次（与单元格保存共用同一 initial
  // 刷新语义）。
  function saveAll() {
    const tasks: Promise<unknown>[] = []
    let saved = 0
    let skippedEmpty = 0

    // Summary（全班共享笔记）
    if (summary !== initial.summary) {
      if (summary.trim()) {
        tasks.push(upsertSharedNote({ lessonId, body: summary }))
        saved++
      } else {
        skippedEmpty++ // 清空 Summary out of scope
      }
    }

    for (const s of roster) {
      // 学生点评
      const body = comments[s.id] ?? ''
      const initialBody = initial.comments[s.id] ?? ''
      if (body !== initialBody) {
        if (body.trim()) {
          tasks.push(upsertStudentNote({ lessonId, studentId: s.id, body }))
          saved++
        } else {
          skippedEmpty++ // 清空点评 out of scope
        }
      }

      // 成绩
      const cell = grades[s.id] ?? { score: '', maxScore: '' }
      const initialCell = initial.grades[s.id]
      const initialScore = initialCell?.score ?? ''
      const initialMaxScore = initialCell?.maxScore ?? ''
      if (cell.score !== initialScore || cell.maxScore !== initialMaxScore) {
        const score = cell.score.trim() === '' ? undefined : cell.score
        const maxScore = cell.maxScore.trim() === '' ? undefined : cell.maxScore
        tasks.push(upsertLessonStudentGrade({ lessonId, studentId: s.id, score, maxScore }))
        saved++
      }
    }

    if (saved === 0) {
      show(skippedEmpty > 0 ? '清空笔记/点评暂不支持保存' : '没有需要保存的更改')
      return
    }

    startTransition(async () => {
      // 批量保存:任一 upsert reject 都可能已有其它写入落库（部分成功）。catch 后给出失败提示，
      // 并在 finally 里始终 router.refresh()——重新拉取 RSC 以呈现真实的已落库状态，避免用户
      // 误判为"没保存"而重复点击。
      try {
        await Promise.all(tasks)
        show(
          skippedEmpty > 0
            ? `已保存全部更改（${saved} 项，清空的笔记/点评已跳过）`
            : `已保存全部更改（${saved} 项）`,
        )
      } catch {
        show('部分更改保存失败，请重试')
      } finally {
        router.refresh()
      }
    })
  }

  return (
    <div className="mt-1 flex flex-col gap-3 rounded border border-neutral-200 bg-neutral-50 p-3">
      {flash && (
        <span aria-live="polite" className="text-xs text-green-700">
          {flash}
        </span>
      )}

      <div className="flex flex-col gap-1">
        <h5 className="text-xs font-medium text-neutral-700">本节课笔记（全班共享 · Summary）</h5>
        <textarea
          className="min-h-16 rounded border border-neutral-300 px-2 py-1 text-sm"
          placeholder="今天讲了…"
          value={summary}
          readOnly={!canManage}
          onChange={(e) => setSummary(e.target.value)}
        />
        {canManage && (
          <button
            type="button"
            disabled={pending}
            onClick={saveSummary}
            className="self-start rounded bg-neutral-900 px-3 py-1 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            保存笔记
          </button>
        )}
      </div>

      {roster.length > 0 && (
        <div className="flex flex-col gap-2">
          <h5 className="text-xs font-medium text-neutral-700">学生点评 & 成绩</h5>
          {roster.map((s) => (
            <div
              key={s.id}
              data-testid="lesson-note-student"
              data-student-id={s.id}
              className="flex flex-col gap-1 rounded border border-neutral-200 bg-white p-2"
            >
              <span className="text-xs text-neutral-600">{s.name}</span>
              <textarea
                className="min-h-12 rounded border border-neutral-300 px-2 py-1 text-sm"
                placeholder={`给 ${s.name} 的本节课点评…`}
                value={comments[s.id] ?? ''}
                readOnly={!canManage}
                onChange={(e) => setComments((prev) => ({ ...prev, [s.id]: e.target.value }))}
              />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-neutral-500">成绩</span>
                <input
                  type="number"
                  className="w-20 rounded border border-neutral-300 px-2 py-1 text-sm tabular-nums"
                  placeholder="分数"
                  value={grades[s.id]?.score ?? ''}
                  readOnly={!canManage}
                  onChange={(e) => setGradeField(s.id, 'score', e.target.value)}
                />
                <span className="text-xs text-neutral-400">/</span>
                <input
                  type="number"
                  className="w-20 rounded border border-neutral-300 px-2 py-1 text-sm tabular-nums"
                  placeholder="满分"
                  value={grades[s.id]?.maxScore ?? ''}
                  readOnly={!canManage}
                  onChange={(e) => setGradeField(s.id, 'maxScore', e.target.value)}
                />
                {canManage && (
                  <>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => saveComment(s.id)}
                      className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
                    >
                      保存点评
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => saveGrade(s.id)}
                      className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
                    >
                      保存成绩
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <div className="flex justify-end border-t border-neutral-200 pt-2">
          <button
            type="button"
            disabled={pending}
            onClick={saveAll}
            className="rounded bg-neutral-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            一键保存全部更改
          </button>
        </div>
      )}
    </div>
  )
}
