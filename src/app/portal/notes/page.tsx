import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { getPortalLessonNotes } from './data'
import MarkdownView from '@/lib/markdown-view'

// 门户「课节笔记」：只显示关联学生所在班级里、教师已「对外开放」(visibility='shared') 的全班共享笔记。
// 行级 scope + 仅 shared + 同意门复检 全在 getPortalLessonNotes 内（面向不可信家长/学生）。正文按
// Markdown + LaTeX 渲染。
export default async function PortalNotesPage() {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['read'] })
  const notes = await getPortalLessonNotes(ctx)

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <h2 className="text-lg font-semibold">课节笔记</h2>
      {notes.length === 0 ? (
        <p className="text-sm text-neutral-500">暂无公开的课节笔记</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {notes.map((n) => (
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
    </section>
  )
}
