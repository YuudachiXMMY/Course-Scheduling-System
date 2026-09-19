'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { upsertSharedNote, upsertStudentNote } from '@/app/dashboard/schedule/attendance-actions'
import { upsertLessonStudentGrade } from './grade-actions'
import { upsertTeachAttendance } from './attendance-actions'
import { useFlash } from '@/app/dashboard/_components/use-flash'
import MarkdownView from '@/lib/markdown-view'
import type { AttendanceStatus } from '@/lib/report-stats'
import type { SectionStudent, LessonNoteRow } from './data'

// 四态出勤标签（与 schedule 的 lesson-detail.tsx STATUS_LABELS 对齐）。value 即 attendanceStatus enum。
const ATT_LABELS = [
  { value: 'present', label: '出勤' },
  { value: 'absent', label: '缺席' },
  { value: 'late', label: '迟到' },
  { value: 'excused', label: '请假' },
] as const

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
  // 「对外开放」：共享笔记是否 visibility='shared'，对门户学生/家长可见。种子来自服务端 summaryVisibility。
  const [shared, setShared] = useState(() => initial.summaryVisibility === 'shared')
  // 预览开关：把 summary 当 Markdown + LaTeX 渲染，便于教师所见即所得地校对公式/排版。
  const [preview, setPreview] = useState(false)
  const [comments, setComments] = useState<Record<string, string>>(() => ({ ...initial.comments }))
  const [grades, setGrades] = useState<Record<string, { score: string; maxScore: string }>>(() => {
    const m: Record<string, { score: string; maxScore: string }> = {}
    for (const [sid, cell] of Object.entries(initial.grades)) {
      m[sid] = { score: cell.score ?? '', maxScore: cell.maxScore ?? '' }
    }
    return m
  })
  const [attendance, setAttendance] = useState<Record<string, AttendanceStatus>>(() => ({
    ...initial.attendance,
  }))
  const [pending, startTransition] = useTransition()
  const { flash, show } = useFlash()
  const router = useRouter()

  function saveSummary() {
    if (!summary.trim()) {
      show('笔记内容为空')
      return
    }
    startTransition(async () => {
      await upsertSharedNote({
        lessonId,
        body: summary,
        visibility: shared ? 'shared' : 'internal',
      })
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

  // 逐生出勤：点击某一态即写库并乐观更新本地高亮。startTransition 内的 await 用 try/catch 兜底，
  // 失败落 show()（避免生产 React #441 脱敏）。attendanceStatus 无"清空"语义——只在四态间切换。
  function markAttendance(studentId: string, status: (typeof ATT_LABELS)[number]['value']) {
    startTransition(async () => {
      try {
        await upsertTeachAttendance({ lessonId, studentId, status })
        setAttendance((prev) => ({ ...prev, [studentId]: status }))
        show('已保存出勤')
        router.refresh()
      } catch {
        show('保存失败')
      }
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

    // Summary（全班共享笔记）：正文改动，或「对外开放」开关被切换，都需落库。visibility-only 的变更
    // 也要保存，否则教师翻动开关但没改正文时开关状态会丢失。upsert 需 body.min(1)，故仍要求正文非空。
    const visibilityChanged = shared !== (initial.summaryVisibility === 'shared')
    if (summary !== initial.summary || visibilityChanged) {
      if (summary.trim()) {
        tasks.push(
          upsertSharedNote({ lessonId, body: summary, visibility: shared ? 'shared' : 'internal' }),
        )
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

      // 出勤：attendanceStatus 无清空语义，只在已选态与 initial 不同（即被切换）时提交。
      const status = attendance[s.id]
      if (status && status !== (initial.attendance[s.id] ?? '')) {
        tasks.push(
          upsertTeachAttendance({
            lessonId,
            studentId: s.id,
            status,
          }),
        )
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
        {/* B32: 父页面标题为 h2，本组内联标题原为 h5（跳过 h3/h4）——降为 h3 保持层级连续。 */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-neutral-700">本节课笔记（全班共享 · Summary）</h3>
          {/* 支持 Markdown + LaTeX（$…$ / $$…$$）——预览开关让教师所见即所得地校对。 */}
          <button
            type="button"
            aria-pressed={preview}
            onClick={() => setPreview((p) => !p)}
            className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-600 hover:bg-neutral-50"
          >
            {preview ? '编辑' : '预览'}
          </button>
        </div>
        {preview ? (
          summary.trim() ? (
            <div className="min-h-16 rounded border border-neutral-200 bg-white px-3 py-2">
              <MarkdownView>{summary}</MarkdownView>
            </div>
          ) : (
            <p className="min-h-16 rounded border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-400">
              暂无内容可预览
            </p>
          )
        ) : (
          <textarea
            className="min-h-16 rounded border border-neutral-300 px-2 py-1 text-sm"
            placeholder="今天讲了…（支持 Markdown 与 LaTeX 公式，如 $E=mc^2$）"
            aria-label="本节课笔记（全班共享）"
            value={summary}
            readOnly={!canManage}
            onChange={(e) => setSummary(e.target.value)}
          />
        )}
        {canManage && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={saveSummary}
              className="rounded bg-neutral-900 px-3 py-1 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              保存笔记
            </button>
            {/* 逐条「对外开放」：勾选后该课节笔记 visibility='shared'，门户的关联学生/家长可见。 */}
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
        )}
      </div>

      {roster.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-neutral-700">学生点评 & 成绩</h3>
          {roster.map((s) => (
            <div
              key={s.id}
              data-testid="lesson-note-student"
              data-student-id={s.id}
              className="flex flex-col gap-1 rounded border border-neutral-200 bg-white p-2"
            >
              <span className="text-xs text-neutral-600">{s.name}</span>
              {/* B34: 逐生表单控件补可访问名称（含学生名），否则屏幕阅读器只念到 placeholder，多生时无法区分。 */}
              <textarea
                className="min-h-12 rounded border border-neutral-300 px-2 py-1 text-sm"
                placeholder={`给 ${s.name} 的本节课点评…`}
                aria-label={`给 ${s.name} 的点评`}
                value={comments[s.id] ?? ''}
                readOnly={!canManage}
                onChange={(e) => setComments((prev) => ({ ...prev, [s.id]: e.target.value }))}
              />
              <div
                className="flex flex-wrap items-center gap-2"
                data-testid="lesson-note-attendance"
                data-student-id={s.id}
              >
                <span className="text-xs text-neutral-500">出勤</span>
                {ATT_LABELS.map((a) => (
                  <button
                    key={a.value}
                    type="button"
                    aria-pressed={attendance[s.id] === a.value}
                    disabled={!canManage || pending}
                    onClick={() => markAttendance(s.id, a.value)}
                    className={`rounded px-2 py-1 text-xs disabled:opacity-50 ${
                      attendance[s.id] === a.value
                        ? 'bg-neutral-900 text-white'
                        : 'border border-neutral-300 text-neutral-600 hover:bg-neutral-50'
                    }`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-neutral-500">成绩</span>
                <input
                  type="number"
                  className="w-20 rounded border border-neutral-300 px-2 py-1 text-sm tabular-nums"
                  placeholder="分数"
                  aria-label={`${s.name} 的成绩分数`}
                  value={grades[s.id]?.score ?? ''}
                  readOnly={!canManage}
                  onChange={(e) => setGradeField(s.id, 'score', e.target.value)}
                />
                <span className="text-xs text-neutral-400">/</span>
                <input
                  type="number"
                  className="w-20 rounded border border-neutral-300 px-2 py-1 text-sm tabular-nums"
                  placeholder="满分"
                  aria-label={`${s.name} 的成绩满分`}
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
