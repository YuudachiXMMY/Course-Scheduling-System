// 门户课节笔记的**纯**筛选逻辑，供客户端组件（notes-list.tsx）与单元测试共用。
//
// 客户端 bundle 边界（见 tests/portal-reports-client-boundary.test.ts 的 B2 不变量）：本模块只从
// server-only 的 ./data 做 `import type`（类型擦除，无运行时依赖），绝不值导入 —— 否则会把 postgres/@auth
// 依赖链打进客户端 bundle。除类型外无任何 server 依赖，可安全被 'use client' 组件导入。
import type { PortalLessonNote } from './data'

// 「全部」哨兵 = 空串（<option value="">）。筛选状态：按班级 + 按单节课(session)。
export interface NotesFilterState {
  sectionId: string // '' = 全部课程
  lessonId: string // '' = 全部课节；否则精确到某一节课(session)
}

// 一个带数量徽标的筛选选项（label 已含「课程名 · 班级名」或「日期」，count 为该桶命中笔记数）。
export interface NotesFilterOption {
  id: string
  label: string
  count: number
}

// 按班级 + 单节课筛选。两者皆为空串时返回全部；组合时取交集。
export function filterNotes(notes: PortalLessonNote[], state: NotesFilterState): PortalLessonNote[] {
  const { sectionId, lessonId } = state
  return notes.filter(
    (n) => (!sectionId || n.sectionId === sectionId) && (!lessonId || n.lessonId === lessonId),
  )
}

// 「按课程班级」下拉选项：笔记里出现过的班级去重，各带数量徽标，按 label 升序稳定排序。
export function sectionOptions(notes: PortalLessonNote[]): NotesFilterOption[] {
  const count = new Map<string, number>()
  const label = new Map<string, string>()
  for (const n of notes) {
    count.set(n.sectionId, (count.get(n.sectionId) ?? 0) + 1)
    if (!label.has(n.sectionId)) label.set(n.sectionId, n.sectionLabel)
  }
  return [...count.entries()]
    .map(([id, c]) => ({ id, label: label.get(id) ?? id, count: c }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

// 「按单节课(session)」下拉选项：先按当前所选班级收敛（未选班级则全部），再按 lessonId 去重，各带数量徽标。
// label = 「课程名 · 班级名 · 日期」以消歧；同一班级内按日期倒序（最近课节在前，与列表主排序一致）。
export function sessionOptions(
  notes: PortalLessonNote[],
  sectionId: string,
): NotesFilterOption[] {
  const scoped = sectionId ? notes.filter((n) => n.sectionId === sectionId) : notes
  const count = new Map<string, number>()
  const meta = new Map<string, { label: string; date: string }>()
  for (const n of scoped) {
    count.set(n.lessonId, (count.get(n.lessonId) ?? 0) + 1)
    if (!meta.has(n.lessonId))
      meta.set(n.lessonId, { label: `${n.sectionLabel} · ${n.lessonDate}`, date: n.lessonDate })
  }
  return [...count.entries()]
    .map(([id, c]) => ({ id, label: meta.get(id)!.label, count: c, date: meta.get(id)!.date }))
    .sort((a, b) => b.date.localeCompare(a.date)) // 日期倒序
    .map(({ id, label, count }) => ({ id, label, count }))
}
