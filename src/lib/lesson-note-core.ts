import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { forTenant } from '@/db/tenant'
import { note } from '@/db/schema'
import type { AuthContext } from '@/auth/context'

export interface SharedNoteInput {
  lessonId: string
  body: string
  visibility?: 'internal' | 'shared'
}

// 共享课节笔记（studentId = null）的 upsert 核心——由 'use server' 动作（web）与测试共同复用（镜像
// upsertLessonStudentGradeCore / report-core）。会话 / 权限 / 课节所有权由包装层校验；此处只经
// forTenant(ctx) 落库。note 表无 (lesson) 唯一约束，故 select-then-write。
//
// visibility 省略时保留已有可见性（新建则默认 internal）——仅改正文时不得把教师此前设置的「对外开放」
// 误降级为 internal（T3 回归）。传入时才更新可见性。
export async function upsertSharedNoteCore(
  ctx: AuthContext,
  data: SharedNoteInput,
): Promise<typeof note.$inferSelect> {
  const existing = await forTenant(ctx).select(
    note,
    and(eq(note.lessonId, data.lessonId), isNull(note.studentId)),
  )
  if (existing[0]) {
    const [row] = await forTenant(ctx).update(note, existing[0].id, {
      body: data.body,
      authorId: ctx.userId,
      ...(data.visibility ? { visibility: data.visibility } : {}),
    })
    return row
  }
  const [row] = await forTenant(ctx).insert(note, {
    lessonId: data.lessonId,
    authorId: ctx.userId,
    body: data.body,
    visibility: data.visibility ?? 'internal',
  })
  return row
}
