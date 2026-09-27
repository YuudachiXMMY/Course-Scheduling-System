import { z } from 'zod'

// 本节课笔记（全班共享）与逐生点评的输入校验。抽到独立模块（非 'use server'、非 server-only）以便
// 直接单测，并被 schedule/attendance-actions.ts 的 Server Action 复用。visibility 取值对齐 DB 的
// noteVisibility 枚举（'internal' | 'shared'）。
//
// 放宽自旧 2000：支持「输入更多内容」——长笔记 / Markdown + LaTeX 源文往往远超 2000 字符。
export const SHARED_NOTE_MAX = 20000
export const STUDENT_NOTE_MAX = 2000

// 账户管理备注（/dashboard/users 的管理员内部备注，覆盖学生/家长/教师/管理员账户）。与课节笔记无关：
// 这是关于「人/账户」的一段可空自由文本，仅管理界面可读写，不进任何门户视图。空白 trim 后归一为 null，
// 使「清空」与「从未填写」是同一状态。client-safe：编辑器组件与服务端 core 共用此上限与校验。
export const ACCOUNT_NOTE_MAX = 2000
export const accountNoteSchema = z.string().trim().max(ACCOUNT_NOTE_MAX, '备注过长')

export const sharedNoteSchema = z.object({
  lessonId: z.string().trim().min(1),
  body: z.string().trim().min(1, '笔记不能为空').max(SHARED_NOTE_MAX),
  // 可选：教师逐条切换「对外开放」。省略时上游保留课节笔记已有可见性（不误降级为 internal）。
  visibility: z.enum(['internal', 'shared']).optional(),
})

export const studentNoteSchema = z.object({
  lessonId: z.string().trim().min(1),
  studentId: z.string().trim().min(1),
  body: z.string().trim().min(1, '点评不能为空').max(STUDENT_NOTE_MAX),
})
