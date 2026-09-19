'use client'

import { useMemo, useState } from 'react'
import MarkdownView from '@/lib/markdown-view'
import { filterNotes, sectionOptions, sessionOptions } from './filter'
import type { PortalLessonNote } from './data'

// 门户课节笔记列表，带两个客户端筛选：按课程班级 + 按单节课(session)。数据已在服务端做行级 scope + 仅
// shared + 同意门复检；本组件只负责视图收敛。每个筛选项带数量徽标；选中班级后 session 选项收敛到该班级。
// 正文按 Markdown + LaTeX 渲染（MarkdownView 亦为 'use client'）。
export default function NotesList({ notes }: { notes: PortalLessonNote[] }) {
  const [sectionId, setSectionId] = useState('')
  const [lessonId, setLessonId] = useState('')

  const sections = useMemo(() => sectionOptions(notes), [notes])
  const sessions = useMemo(() => sessionOptions(notes, sectionId), [notes, sectionId])
  const filtered = useMemo(
    () => filterNotes(notes, { sectionId, lessonId }),
    [notes, sectionId, lessonId],
  )

  // 切换班级时，若已选的单节课不在新班级下，清空 session 选择，避免出现空结果的悬挂筛选。
  const onSection = (id: string) => {
    setSectionId(id)
    if (lessonId && !notes.some((n) => n.lessonId === lessonId && (!id || n.sectionId === id))) {
      setLessonId('')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-3">
        <select
          aria-label="按课程班级筛选"
          value={sectionId}
          onChange={(e) => onSection(e.target.value)}
          className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
        >
          <option value="">全部课程</option>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} ({s.count})
            </option>
          ))}
        </select>
        <select
          aria-label="按单节课筛选"
          value={lessonId}
          onChange={(e) => setLessonId(e.target.value)}
          className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
        >
          <option value="">全部课节</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} ({s.count})
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-neutral-500">暂无符合筛选条件的课节笔记</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {filtered.map((n) => (
            <li key={n.id} className="rounded border border-neutral-200 bg-white p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-neutral-800">{n.sectionLabel}</span>
                <span className="text-xs text-neutral-500 tabular-nums">{n.lessonDate}</span>
              </div>
              <MarkdownView>{n.body}</MarkdownView>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
