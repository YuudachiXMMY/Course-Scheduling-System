# Plan: 班级工作台「排课」Tab 内统一管理每节课笔记(Summary)与每个学生的点评/成绩

## Summary
在 `课程 → 班级`(`/dashboard/teach/[sectionId]` 的「排课」tab)里,给每个课节行增加一个**行内展开**区,一屏内批量查看并编辑:本节课全班共享笔记(Summary)、每个在读学生的点评(per-student note),以及可选的课堂成绩(grade)。替代当前只能逐节点开 `LessonDetail` 抽屉、一次编辑一节课的做法。**复用**已有的 `note` 表与 `upsertSharedNote`/`upsertStudentNote` server actions,**新增**一个轻量的每(课节, 学生)成绩 upsert action。**无需数据库迁移**(note、grade 表已具备全部所需列)。

## User Story
As a 老师/助教(teacher/assistant),
I want 在班级工作台的排课列表里直接展开每节课、成批填写本节课笔记和每个学生的点评与成绩,
So that 我不用为每节课逐一点开抽屉,就能在一个地方统一管理整学期的课堂记录,并让这些记录直接喂给进度报告。

## Problem → Solution
**现状**:笔记(Summary)与学生点评只能在 `/dashboard/schedule` 日历或排课 tab 里**逐节**点击课节 → 打开 `LessonDetail` 抽屉 → 编辑单节课的共享笔记 + 每个学生点评。没有跨课节的统一视图;成绩(grade)则**完全没有任何写入 UI**(仅测试/种子直接插库)。
**目标**:在排课 tab 的课节行下方**行内展开** Summary + 每学生(点评 + 可选成绩)的编辑区,一屏批量管理;成绩为可选、非每次必填。

## Metadata
- **Complexity**: Medium
- **Source PRD**: N/A(自由描述:"课程->班级 里面可以 统一修改/管理 每节课的 笔记(Summary),每个学生的comment")
- **PRD Phase**: N/A
- **Estimated Files**: 新增 2 个(grade-actions.ts、lesson-notes-inline.tsx)+ 修改 3 个(data.ts、lessons-panel.tsx、section-lessons.tsx)+ 2 个测试

---

## 需求澄清结论(已与用户确认)
1. **UI 落点/布局**:**扩展现有「排课」Tab,行内展开**(不新增 tab)。每个课节行加「展开▼」;展开后显示 `Summary`(全班)+ 每个在读学生的 `点评`。
2. **"comment" 语义**:主字段 = **已有的点评数据**(`note` 表,`lessonId`+`studentId`),复用 `upsertStudentNote`;**额外追加可选的成绩(grade)**——成绩**不是每次必填**。因此每(学生, 课节)单元格包含:`点评` textarea(主)+ 可选 `成绩`(分数,选填 满分/评语)。

---

## UX Design

### Before
```
排课 tab（/dashboard/teach/[sectionId]?tab=lessons）
─────────────────────────────────────────────
09月10日 周三
  16:00–17:00  二次函数   教室A          [改期]   ← 整行点击=打开 LessonDetail 抽屉
─────────────────────────────────────────────
（编辑笔记/点评：必须点开抽屉，一次只看一节课）

抽屉 LessonDetail（逐节）：
  ┌ 课节详情 ─────────────┐
  │ 上课地点/网课链接        │
  │ 出勤                     │
  │ 本节课笔记（全班共享）   │  ← Summary
  │ 学生点评（每人独立）     │  ← comment（note）
  └──────────────────────┘
```

### After
```
排课 tab（/dashboard/teach/[sectionId]?tab=lessons）
─────────────────────────────────────────────
09月10日 周三
  16:00–17:00 二次函数 教室A     [笔记点评 展开▼] [改期]
    ┌ 本节课笔记（全班共享 · Summary）────────────┐
    │ [今天讲了二次函数……              ] [保存笔记] │
    ├ 学生点评 & 成绩 ────────────────────────────┤
    │ 张三  点评[上课专注，作业待补交  ] 成绩[85]/[100] [保存] │
    │ 李四  点评[进步明显              ] 成绩[  ]/[   ] [保存] │
    └──────────────────────────────────────────┘
  16:00–17:00 因式分解        [笔记点评 展开▶] [改期]
─────────────────────────────────────────────
（整行 title 点击仍可打开 LessonDetail 抽屉做出勤/取消/改地点——两者互补）
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| 编辑某节课 Summary | 点开抽屉 → 找到「本节课笔记」 | 排课 tab 行内「展开▼」直接编辑 | 复用 `upsertSharedNote` |
| 编辑某学生点评 | 点开抽屉 → 「学生点评」区 | 行内展开区 每学生一行 | 复用 `upsertStudentNote` |
| 记录某学生成绩 | ❌ 无 UI(仅种子/API) | 行内展开区 每学生「成绩」选填 | **新增** `upsertLessonStudentGrade` |
| 出勤/取消/改地点 | 抽屉 | 抽屉(保持不变) | 整行 title 点击仍打开抽屉 |

---

## Mandatory Reading

实现前必须先读的文件(全部为本仓库真实文件):

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/app/dashboard/schedule/attendance-actions.ts` | 107–202 | 要**复用**的 `getLessonNotes`/`upsertSharedNote`/`upsertStudentNote`;note 无唯一约束→select-then-write 的权威范式 |
| P0 | `src/db/schema/note.ts` | 1–43 | note 表结构:可空 lessonId/sectionId/studentId、body、visibility;shared=studentId null,comment=studentId set |
| P0 | `src/db/schema/grade.ts` | 1–58 | grade 表:studentId+lessonId、score/maxScore(numeric→字符串)、comment、title、gradedBy/gradedAt、onDelete restrict、check(lessonId 或 sectionId 非空) |
| P0 | `src/app/dashboard/teach/[sectionId]/data.ts` | 1–169 | server-only 加载器约定;`getSectionRoster`(55–69)、`getSectionLessons`(74–120)、inArray 用法(126–143) |
| P0 | `src/app/dashboard/teach/[sectionId]/section-lessons.tsx` | 1–255 | 要改的客户端组件:课节分组渲染 + 打开抽屉 + 改期。展开开关加在这里 |
| P0 | `src/app/dashboard/schedule/lesson-detail.tsx` | 1–259 | 客户端编辑器范式:useTransition、本地乐观 state、保存按钮、成功提示——行内编辑器照此写 |
| P1 | `src/app/dashboard/teach/[sectionId]/tabs/lessons-panel.tsx` | 1–17 | server 面板:awaits ctx + 加载器,传 `canManage` 给客户端。要在此加载 notes 矩阵 |
| P1 | `src/app/dashboard/students/actions.ts` | 1–38 | server action 4 步范式(ctx→requirePermission→zod.parse→forTenant 写)+ revalidatePath |
| P1 | `src/db/tenant.ts` | 1–56 | `forTenant(ctx)` 是唯一合法的租户读写通道(select/findById/insert/update/delete) |
| P1 | `src/lib/report-data.ts` | 30–101 | inArray 批量加载 + grade/note 分组范式;**证明本功能的数据会喂给进度报告**(notes、grade.comment) |
| P1 | `src/auth/authorize.ts` + `src/auth/permissions.ts` | 全 | `can`/`requirePermission`;角色矩阵——teacher/assistant/admin/owner 均有 `lesson:update` |
| P2 | `src/app/dashboard/teach/[sectionId]/tabs/reports-panel.tsx` | 1–48 | 面板 Promise.all 多源加载 + `can()` 传参的镜像 |
| P2 | `src/app/dashboard/_components/use-flash.ts` | 全 | 无 toast 库的瞬时成功提示 hook(可选用于行内保存反馈) |
| P2 | `tests/report-db.test.ts` | 1–128 | vitest DB 集成测试骨架:`ctxFor`、forTenant 播种、cleanup、租户隔离断言 |
| P2 | `tests/e2e/dashboard/schedule.spec.ts` | 1–95 | Playwright 范式:打开抽屉、填 textarea、断言成功提示 |
| P2 | `src/app/dashboard/teach/[sectionId]/page.tsx` | 1–56 | tab 路由 switch + keyed Suspense(理解 lessons 面板如何被挂载) |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| 定制版 Next.js | `AGENTS.md` + `node_modules/next/dist/docs/` | 本仓库 Next 有 breaking changes;本功能仅用**已在库中反复使用**的原语(RSC、Server Action、`revalidatePath`、`useTransition`),照抄现有文件即可,风险低。若要用到任何新 API,先读 `node_modules/next/dist/docs/`。 |

> 结论:No external research needed — 全部基于已确立的内部模式(server-only loader + 'use server' action + forTenant spine + 客户端 useTransition/本地 state)。

---

## Patterns to Mirror

以下均为代码库真实片段,严格照此写,新代码要与现有代码无法区分。

### SERVER_ACTION_UPSERT(select-then-write;note/grade 均无 (lesson,student) 唯一约束)
```ts
// SOURCE: src/app/dashboard/schedule/attendance-actions.ts:175-202  (upsertStudentNote)
export async function upsertStudentNote(input: z.input<typeof studentNoteSchema>) {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['update'] })
  const data = studentNoteSchema.parse(input)

  const existing = (await forTenant(ctx).select(
    note,
    and(eq(note.lessonId, data.lessonId), eq(note.studentId, data.studentId)),
  )) as (typeof note.$inferSelect)[]

  if (existing[0]) {
    const [row] = await forTenant(ctx).update(note, existing[0].id, {
      body: data.body, authorId: ctx.userId,
    })
    revalidatePath('/dashboard/schedule')
    return row
  }
  const [row] = await forTenant(ctx).insert(note, {
    lessonId: data.lessonId, studentId: data.studentId,
    authorId: ctx.userId, body: data.body, visibility: 'internal',
  })
  revalidatePath('/dashboard/schedule')
  return row
}
```

### SERVER_ACTION_4STEP(ctx → RBAC → zod → forTenant 写 → revalidate)
```ts
// SOURCE: src/app/dashboard/students/actions.ts:20-32
export async function createStudent(input: CreateStudentInput) {
  const ctx = await requireAuthContext()          // 1) 验证主体 + 租户(忽略客户端 orgId)
  requirePermission(ctx, { student: ['create'] }) // 2) 顶部 RBAC
  const data = createStudentSchema.parse(input)   // 3) 落库前校验+trim
  const [row] = await forTenant(ctx).insert(student, { name: data.name, /* … */ })
  revalidatePath('/dashboard/students')
  return row
}
```

### SERVER_ONLY_LOADER(接 ctx,全走 forTenant;inArray 批量)
```ts
// SOURCE: src/app/dashboard/teach/[sectionId]/data.ts:126-143  (getSectionPendingRescheduleCount)
const lessonIds = lessons.map((l) => l.id)               // 非空(上面已 guard)
const pending = (await forTenant(ctx).select(
  rescheduleRequest,
  and(eq(rescheduleRequest.status, 'pending'), inArray(rescheduleRequest.lessonId, lessonIds)),
)) as (typeof rescheduleRequest.$inferSelect)[]
```
```ts
// SOURCE: src/app/dashboard/schedule/attendance-actions.ts:116-132  (getLessonNotes 分组:latest-wins)
rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()) // oldest→newest,后写覆盖
let shared = ''
const perStudent: Record<string, string> = {}
for (const r of rows) {
  if (r.studentId) perStudent[r.studentId] = r.body
  else shared = r.body
}
```

### PANEL_PATTERN(server 面板:Promise.all 多源 + can() 传 canManage)
```ts
// SOURCE: src/app/dashboard/teach/[sectionId]/tabs/reports-panel.tsx:20-24, 40
const ctx = await requireAuthContext()
const [roster, reports] = await Promise.all([
  getSectionRoster(ctx, sectionId),
  getSectionReports(ctx, sectionId),
])
// …
canWrite={can(ctx.role, { report: ['create'] })}
```

### CLIENT_EDITOR(useTransition + 本地乐观 state + 保存按钮 + 成功提示)
```tsx
// SOURCE: src/app/dashboard/schedule/lesson-detail.tsx:81-91, 198-214
function saveComment(studentId: string) {
  const body = comments[studentId] ?? ''
  if (!body.trim()) { setMsg('点评内容为空'); return }
  startTransition(async () => {
    await upsertStudentNote({ lessonId, studentId, body })
    setMsg('已保存学生点评')
  })
}
// …textarea 受控 + 保存按钮 disabled={pending}
```

### TIMEZONE(永远用 APP_TIME_ZONE,不硬编码)
```ts
// SOURCE: src/app/dashboard/teach/[sectionId]/section-lessons.tsx:11-19
import { APP_TIME_ZONE } from '@/lib/timezone'
const ZONE = APP_TIME_ZONE
const fmtTime = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' }).setZone(ZONE).toFormat('HH:mm')
```

### TEST_STRUCTURE(vitest DB 集成:ctxFor + forTenant 播种 + cleanup + 租户隔离)
```ts
// SOURCE: tests/report-db.test.ts:38-43, 86-118
const ctxFor = (tenantId: string, userId: string, role = 'owner'): AuthContext =>
  ({ tenantId, userId, role, isPlatformAdmin: false })
const ctx = ctxFor(org, userId)
const [c]   = (await forTenant(ctx).insert(course, { title: '数学' })) as { id: string }[]
const [sec] = (await forTenant(ctx).insert(classSection, { courseId: c.id, teacherId, capacity: 1 })) as { id: string }[]
const [le1] = (await forTenant(ctx).insert(lesson, { sectionId, teacherId, startAt: at(10), endAt: at(11) })) as { id: string }[]
await forTenant(ctx).insert(grade, { studentId, lessonId: l1, title: '月考', score: '85.00' }) // score 存字符串
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/app/dashboard/teach/[sectionId]/data.ts` | UPDATE | 加 `QUICK_GRADE_TITLE` 常量 + `getSectionLessonNotes(ctx, lessonIds)` 批量加载器(note + grade,分组成矩阵)+ 类型 `LessonNoteRow` |
| `src/app/dashboard/teach/[sectionId]/grade-actions.ts` | CREATE | 新增 `upsertLessonStudentGrade`(选填成绩,空→删)——目前全库无任何 grade 写入 action |
| `src/app/dashboard/teach/[sectionId]/lesson-notes-inline.tsx` | CREATE | 客户端行内编辑器:Summary + 每学生(点评+成绩),复用 note actions + 新 grade action |
| `src/app/dashboard/teach/[sectionId]/tabs/lessons-panel.tsx` | UPDATE | 额外加载 roster + notes 矩阵,连同 lessons 一并传给 `SectionLessons` |
| `src/app/dashboard/teach/[sectionId]/section-lessons.tsx` | UPDATE | 每行加「笔记点评 展开」开关;展开时渲染 `LessonNotesInline` |
| `tests/section-notes.test.ts` | CREATE | 单测:`getSectionLessonNotes` 分组/latest-wins/租户隔离 + `upsertLessonStudentGrade` upsert/删除/隔离 |
| `tests/e2e/dashboard/teach-notes.spec.ts` | CREATE | E2E:排课 tab 展开一节课 → 填 Summary + 学生点评 + 成绩 → 保存 → 断言成功提示 |

## NOT Building(明确排除,防止范围蔓延)
- ❌ **不新增 tab**、不做独立矩阵页(用户明确选了"扩展排课 tab 行内展开")。
- ❌ **不做数据库迁移 / 不改 schema**(note、grade 表已够用)。
- ❌ **不动 `LessonDetail` 抽屉**(出勤/取消/改地点保持原样;行内展开只管笔记+点评+成绩)。抽屉里原有的笔记/点评编辑保留,与行内区**故意重叠**(同读 note 表,各自本地乐观 state,页面导航后重新播种)。
- ❌ **不做多次考核成绩**(月考/期中等 title 化多行成绩)。行内成绩是**单个**每(课节,学生)行,用固定 title 哨兵 `课堂表现` 隔离,一节课一学生一条。多考核成绩为未来工作。
- ❌ **不做一键批量保存全部编辑**(MVP:每单元格独立保存,复用现有 per-cell action;后续可加"全部保存")。
- ❌ **不做实时协作/并发合并**(select-then-write 最后写覆盖,与现有 note/attendance 一致)。
- ❌ **不做成绩的分数校验规则/评分标准 rubric**(rubric 字段留空)。

---

## Step-by-Step Tasks

### Task 1: 在 data.ts 加成绩哨兵常量 + 批量加载器
- **ACTION**: 修改 `src/app/dashboard/teach/[sectionId]/data.ts`,新增导出常量、类型与 `getSectionLessonNotes`。
- **IMPLEMENT**:
  ```ts
  // 行内「排课」成绩编辑器管理 ONE 个每(课节,学生)轻量成绩行,用此哨兵 title 与将来 titled 考核(月考/期中)隔离。
  export const QUICK_GRADE_TITLE = '课堂表现'

  export interface LessonGradeCell {
    score: string | null    // node-pg 把 numeric 当字符串返回
    maxScore: string | null
    comment: string | null
  }
  export interface LessonNoteRow {
    summary: string                                  // 全班共享笔记(note.studentId = null)
    comments: Record<string, string>                 // studentId -> 点评(note.studentId set)
    grades: Record<string, LessonGradeCell>          // studentId -> 课堂成绩(title = QUICK_GRADE_TITLE)
  }

  // 一次性加载本班全部课节的笔记矩阵。note/grade 都按 lessonId 归属(shared=studentId null),
  // 用 inArray 批量拉取(镜像 report-data.ts / getSectionPendingRescheduleCount)。lessonIds 由调用方
  // (lessons-panel)从 getSectionLessons 结果传入,避免重复查 lesson 表。
  export async function getSectionLessonNotes(
    ctx: AuthContext,
    lessonIds: string[],
  ): Promise<Record<string, LessonNoteRow>> {
    const byLesson: Record<string, LessonNoteRow> = {}
    for (const id of lessonIds) byLesson[id] = { summary: '', comments: {}, grades: {} }
    if (lessonIds.length === 0) return byLesson   // 空 inArray([]) 是非法 SQL → guard

    const noteRows = (await forTenant(ctx).select(
      note, inArray(note.lessonId, lessonIds),
    )) as (typeof note.$inferSelect)[]
    noteRows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()) // oldest→newest,后写覆盖
    for (const n of noteRows) {
      if (!n.lessonId) continue
      const row = byLesson[n.lessonId]; if (!row) continue
      if (n.studentId) row.comments[n.studentId] = n.body
      else row.summary = n.body
    }

    const gradeRows = (await forTenant(ctx).select(
      grade, inArray(grade.lessonId, lessonIds),
    )) as (typeof grade.$inferSelect)[]
    for (const g of gradeRows) {
      if (!g.lessonId || g.studentId == null || g.title !== QUICK_GRADE_TITLE) continue
      const row = byLesson[g.lessonId]; if (!row) continue
      row.grades[g.studentId] = { score: g.score, maxScore: g.maxScore, comment: g.comment }
    }
    return byLesson
  }
  ```
- **MIRROR**: SERVER_ONLY_LOADER(inArray + latest-wins 分组)。
- **IMPORTS**: 在 data.ts 顶部已 import `inArray`(第 2 行 `from 'drizzle-orm'` 已含);需补 `note`、`grade` 到 `@/db/schema` 的 import(现有 import 里没有这两个——加上)。`forTenant`、`AuthContext` 已 import。
- **GOTCHA**:
  - **`note`/`grade` 的成绩/点评都挂在 `lessonId` 上,不是 `sectionId`**(见 `upsertSharedNote` 插入的是 lessonId、sectionId 留空)。所以必须用 lessonIds 的 inArray,不能按 `note.sectionId` 查。
  - 空 `inArray([])` → 非法 SQL,务必先 guard(报告代码同款注释见 report-data.ts:37)。
  - 成绩过滤必须带 `title === QUICK_GRADE_TITLE`,否则将来 titled 考核会混入行内单元格。
- **VALIDATE**: `npm run typecheck` 通过;单测 Task 6 覆盖分组正确性。

### Task 2: 新增 grade-actions.ts(选填成绩 upsert;空则删)
- **ACTION**: 创建 `src/app/dashboard/teach/[sectionId]/grade-actions.ts`。
- **IMPLEMENT**:
  ```ts
  'use server'
  import { z } from 'zod'
  import { revalidatePath } from 'next/cache'
  import { and, eq } from 'drizzle-orm'
  import { requireAuthContext } from '@/auth/context'
  import { requirePermission } from '@/auth/authorize'
  import { forTenant } from '@/db/tenant'
  import { grade } from '@/db/schema'
  import { QUICK_GRADE_TITLE } from './data' // 常量,不放在本 'use server' 文件里(见 GOTCHA)

  // 课堂成绩按课节记录 → 沿用 lesson 权限(与出勤/笔记一致:见 attendance-actions.ts:57 注释)。
  const gradeSchema = z.object({
    lessonId: z.string().trim().min(1),
    studentId: z.string().trim().min(1),
    score: z.coerce.number().min(0).max(9999).optional(),
    maxScore: z.coerce.number().min(0).max(9999).optional(),
    comment: z.string().trim().max(2000).optional(),
  })

  // 单个每(课节,学生)成绩行(title=哨兵),select-then-write upsert;三项全空 → 删除该行(成绩非必填)。
  export async function upsertLessonStudentGrade(input: z.input<typeof gradeSchema>) {
    const ctx = await requireAuthContext()
    requirePermission(ctx, { lesson: ['update'] })
    const data = gradeSchema.parse(input)

    const existing = (await forTenant(ctx).select(
      grade,
      and(eq(grade.lessonId, data.lessonId), eq(grade.studentId, data.studentId), eq(grade.title, QUICK_GRADE_TITLE)),
    )) as (typeof grade.$inferSelect)[]

    const empty = data.score == null && data.maxScore == null && !data.comment
    if (empty) {
      if (existing[0]) await forTenant(ctx).delete(grade, existing[0].id) // 删成绩行本身不受 onDelete restrict 限制
      revalidatePath('/dashboard/schedule')
      return null
    }

    const values = {
      score: data.score != null ? String(data.score) : null,       // numeric 列存字符串
      maxScore: data.maxScore != null ? String(data.maxScore) : null,
      comment: data.comment || null,
      gradedBy: ctx.userId,
      gradedAt: new Date(),
    }
    if (existing[0]) {
      const [row] = await forTenant(ctx).update(grade, existing[0].id, values)
      revalidatePath('/dashboard/schedule')
      return row
    }
    const [row] = await forTenant(ctx).insert(grade, {
      studentId: data.studentId, lessonId: data.lessonId, title: QUICK_GRADE_TITLE, ...values,
    })
    revalidatePath('/dashboard/schedule')
    return row
  }
  ```
- **MIRROR**: SERVER_ACTION_UPSERT + SERVER_ACTION_4STEP。
- **IMPORTS**: 见上。
- **GOTCHA**:
  - **`'use server'` 文件只能导出 async 函数**——所以 `QUICK_GRADE_TITLE` 常量放在 `data.ts`(server-only,非 'use server'),这里 import 进来。若把常量 export 在本文件会被 Next 报错。
  - grade 的 `onDelete('restrict')` 是防止删除**被引用的 student/lesson/section**;删除 grade **行本身**是允许的。
  - grade check `ck_grade_target`:lessonId 或 sectionId 至少一个非空——这里 lessonId 恒非空,满足。
  - score/maxScore 用 `z.coerce.number()`(客户端传字符串),落库转回 `String()`。
- **VALIDATE**: `npm run typecheck`;单测 Task 6 覆盖 insert/update/delete/租户隔离。

### Task 3: 新增行内编辑器客户端组件 lesson-notes-inline.tsx
- **ACTION**: 创建 `src/app/dashboard/teach/[sectionId]/lesson-notes-inline.tsx`(`'use client'`)。
- **IMPLEMENT**: props = `{ lessonId, roster: SectionStudent[], initial: LessonNoteRow, canManage: boolean }`。
  - 本地 state:`summary`、`comments: Record<sid,string>`、`grades: Record<sid,{score,maxScore,comment}>`,均用 `initial` 播种(`useState(() => initial…)`)。
  - `const [pending, startTransition] = useTransition()`;`const { flash, show } = useFlash()`。
  - `saveSummary()` → `upsertSharedNote({ lessonId, body: summary })`(from `@/app/dashboard/schedule/attendance-actions`);`show('已保存本节课笔记')`。
  - `saveComment(sid)` → `upsertStudentNote({ lessonId, studentId: sid, body: comments[sid] })`;`show('已保存点评')`。
  - `saveGrade(sid)` → `upsertLessonStudentGrade({ lessonId, studentId: sid, score, maxScore, comment })`(from `./grade-actions`);`show('已保存成绩')`。允许三项为空(=删除)。
  - `canManage=false`(assistant 只读也满足 lesson:update? 见 GOTCHA)→ textarea `readOnly`、隐藏保存按钮。
  - roster 为空 → 只渲染 Summary(镜像 `lesson-detail.tsx:216` 的 `roster.length > 0` guard)。
  - 复用 `lesson-detail.tsx` 的 Tailwind class 风格(`rounded border border-neutral-300 px-2 py-1 text-sm` 等)保持视觉一致。
- **MIRROR**: CLIENT_EDITOR(`src/app/dashboard/schedule/lesson-detail.tsx:81-91,198-241`)。
- **IMPORTS**:
  ```ts
  import { useState, useTransition } from 'react'
  import { upsertSharedNote, upsertStudentNote } from '@/app/dashboard/schedule/attendance-actions'
  import { upsertLessonStudentGrade } from './grade-actions'
  import { useFlash } from '@/app/dashboard/_components/use-flash'
  import type { SectionStudent } from './data'
  import type { LessonNoteRow } from './data'
  ```
- **GOTCHA**:
  - **点评/笔记复用的 action `revalidatePath('/dashboard/schedule')`**,不 revalidate 当前 teach 路径。**不需要** `router.refresh()`——本地乐观 state 已持有最新值 + flash 提示(与 `LessonDetail` 保存笔记/点评时完全一致:它保存 note 时也不 refresh,只 setMsg)。
  - 成绩分数输入用 `<input type="number">` 或普通 text,value 显示 `grades[sid]?.score ?? ''`;传给 action 前保持字符串,靠 `z.coerce.number()` 转换。
  - 空点评:现有 `upsertStudentNote` schema 要求 `body.min(1)`——空点评会抛校验错。行内保留同款"内容为空则提示、不发请求"的前置 guard(镜像 `saveComment` 的 `if (!body.trim())`)。若要支持"清空点评",属额外范围,不在本次(见 NOT Building)。
  - **权限**:`canManage` 由面板用 `can(ctx.role, { lesson: ['update'] })` 计算。注意 assistant 也有 `lesson:update`(permissions.ts:58),所以助教可写笔记/点评/成绩——与出勤一致,符合预期。
- **VALIDATE**: `npm run typecheck` + `npm run lint`;E2E Task 7 覆盖交互。

### Task 4: lessons-panel.tsx 加载 roster + notes 矩阵并下传
- **ACTION**: 修改 `src/app/dashboard/teach/[sectionId]/tabs/lessons-panel.tsx`。
- **IMPLEMENT**:
  ```tsx
  import { requireAuthContext } from '@/auth/context'
  import { can } from '@/auth/authorize'
  import { getSectionLessons, getSectionRoster, getSectionLessonNotes } from '../data'
  import SectionLessons from '../section-lessons'

  export default async function LessonsPanel({ sectionId }: { sectionId: string }) {
    const ctx = await requireAuthContext()
    const [lessons, roster] = await Promise.all([
      getSectionLessons(ctx, sectionId),
      getSectionRoster(ctx, sectionId),
    ])
    const notes = await getSectionLessonNotes(ctx, lessons.map((l) => l.id))
    return (
      <SectionLessons
        sectionId={sectionId}
        lessons={lessons}
        roster={roster}
        notes={notes}
        canManage={can(ctx.role, { lesson: ['update'] })}
      />
    )
  }
  ```
- **MIRROR**: PANEL_PATTERN(reports-panel.tsx Promise.all + can())。
- **IMPORTS**: 见上。
- **GOTCHA**: `getSectionLessonNotes` 依赖 lessons 的 id,故在 `Promise.all` 之后单独 await(需要 lessons 结果)。`canManage` 从原来的 `lesson:['update']` 不变(现有 lessons-panel 已用此权限)。
- **VALIDATE**: `npm run typecheck`;面板能 SC 播种(无客户端 useEffect fetch,符合 teach 工作台约定)。

### Task 5: section-lessons.tsx 加展开开关 + 渲染行内编辑器
- **ACTION**: 修改 `src/app/dashboard/teach/[sectionId]/section-lessons.tsx`。
- **IMPLEMENT**:
  - props 扩展:加 `roster: SectionStudent[]` 与 `notes: Record<string, LessonNoteRow>`。
  - 新 state:`const [notesOpenId, setNotesOpenId] = useState<string | null>(null)`。
  - 每个课节行(`l.id`)在「改期」按钮旁加一个「笔记点评」开关按钮:`onClick={() => setNotesOpenId(notesOpenId === l.id ? null : l.id)}`,文案随展开态切换(`展开▼`/`收起▶` 或 `笔记点评`)。
  - 在该 `<li>` 内(改期编辑块之后)条件渲染:
    ```tsx
    {notesOpenId === l.id && (
      <LessonNotesInline
        lessonId={l.id}
        roster={roster}
        initial={notes[l.id] ?? { summary: '', comments: {}, grades: {} }}
        canManage={canManage}
      />
    )}
    ```
  - 保留现有整行 title 点击 → `setOpenId(l.id)` 打开 `LessonDetail` 抽屉(出勤/取消/改地点)。两个开关互不影响。
- **MIRROR**: 现有 `editId`/改期块的 toggle 与条件渲染范式(section-lessons.tsx:180-222)。
- **IMPORTS**: `import LessonNotesInline from './lesson-notes-inline'`;`import type { SectionStudent, LessonNoteRow } from './data'`。
- **GOTCHA**:
  - `page.tsx` 的 Suspense key 含 `sectionId`,切换班级会 remount `SectionLessons`,`notesOpenId` 会自动清空(避免跨班级泄漏,同现有 openId/editId 注释 page.tsx:28-31)。
  - `notes[l.id]` 可能为 undefined(理论上 loader 已为每个 lessonId 建空行,但防御性给默认值)。
- **VALIDATE**: `npm run typecheck` + `npm run lint`;手动:排课 tab 展开一节课看到 Summary + 学生行。

### Task 6: 单元测试 tests/section-notes.test.ts
- **ACTION**: 创建 `tests/section-notes.test.ts`(vitest,DB 集成)。
- **IMPLEMENT**: 播种一个 tenant + course + section + 2 学生(active enrollment)+ 2 课节;写入 shared note、per-student note、成绩,断言:
  - `getSectionLessonNotes([l1,l2])` 返回矩阵:`byLesson[l1].summary` 正确、`comments[sid]` 正确、`grades[sid].score` 正确;`byLesson[l2]` 为空默认。
  - **latest-wins**:对同一 (l1, studentId) 连写两条 note,取最新 body。
  - **成绩过滤**:插一条 `title:'月考'` 的 grade 到 l1 → 不出现在 `grades`(只认 `QUICK_GRADE_TITLE`)。
  - `upsertLessonStudentGrade`:首次 insert→再次 update(同一行)→ 传空三项 → 该行被删除(再查为空)。
  - **租户隔离**:另一 tenant 的 ctx 读不到本 tenant 的 notes 矩阵(空)、写 grade 不影响本 tenant。
- **MIRROR**: TEST_STRUCTURE(`tests/report-db.test.ts` 的 ctxFor / forTenant 播种 / cleanup / 隔离断言)。
- **IMPORTS**: 从 `@/app/dashboard/teach/[sectionId]/data` 导入 `getSectionLessonNotes`、`QUICK_GRADE_TITLE`;从 `.../grade-actions` 导入 `upsertLessonStudentGrade`——但 grade-actions 是 `'use server'` 且用 `requireAuthContext()`(读 headers/session),单测里无 session。**GOTCHA(见下)**。
- **GOTCHA**:
  - `upsertLessonStudentGrade` 内部 `requireAuthContext()` 依赖 Next `headers()`/session,vitest 里没有。参考现有单测:`tests/report-db.test.ts` 测的是 **core 层**(`report-core.ts` 接 `ctx` 参数),不是直接测 `'use server'` action。**同款做法**:把可测的写逻辑做成接 `ctx` 的纯函数放 `data.ts` 或一个 `-core` 文件,action 只做 `requireAuthContext()+requirePermission` 后转调 core。→ **建议 Task 2 拆分**:`grade-actions.ts` 的 action 调用 `upsertLessonStudentGradeCore(ctx, data)`(放 data.ts,server-only,接 ctx),单测测 core;action 薄壳不单测(E2E 覆盖)。这与 report-core/report-data 的分层完全一致。
  - 若不想拆分,单测可 `vi.mock('@/auth/context')` 返回固定 ctx——但仓库惯例是 core 分层(见 report-db.test.ts:30-36),优先分层。
- **VALIDATE**: `npm run test`(vitest)全绿。

### Task 7: E2E 测试 tests/e2e/dashboard/teach-notes.spec.ts
- **ACTION**: 创建 `tests/e2e/dashboard/teach-notes.spec.ts`。
- **IMPLEMENT**:
  1. `page.goto('/dashboard/teach')` → 从 course-tree 进入一个有课节+在读学生的班级(或直接 `goto('/dashboard/teach/<seededSectionId>?tab=lessons')`,用种子常量)。
  2. 断言排课列表出现;点某课节行的「笔记点评」展开按钮。
  3. 填 Summary(`唯一内容-${Date.now()}`)→ 点「保存笔记」→ 断言成功提示(如 `已保存本节课笔记`)。
  4. 若有学生行:填第一个学生点评 + 成绩分数 → 保存 → 断言成功提示。
- **MIRROR**: `tests/e2e/dashboard/schedule.spec.ts`(填 textarea + 断言绿色成功提示;`page.on('dialog', d => d.accept())` 前置)。
- **IMPORTS/FIXTURES**: `import { test, expect } from '../fixtures/test'`;确认种子(`tests/e2e/fixtures/seed-data.ts` / `seed-constants.ts`)里有一个班级带**近期课节 + active enrollment**(schedule.spec.ts 依赖的同一套种子:section A 有 now 附近的课节)。若需要,用 seed-constants 里现成的 sectionId。
- **GOTCHA**:
  - 受控组件竞态:先等面板加载/展开完成再填,避免初始 state 覆盖输入(schedule.spec.ts:56 同款注意)。
  - E2E 默认 owner storageState → 有 `lesson:update`。
- **VALIDATE**: `npm run test:e2e`(需先 `npm run db:seed:e2e` 按项目约定)。

### Task 8: 全量校验 + 提交前检查
- **ACTION**: 跑完整校验命令(见下 Validation Commands)。
- **VALIDATE**: typecheck / lint / vitest / e2e 全绿;手动过一遍 After 交互。

---

## Testing Strategy

### Unit Tests(vitest,DB 集成,测 core/loader 层)
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| 矩阵分组 | section 2 课节 + shared/per-student note + 成绩 | `byLesson[l1]` summary/comments/grades 正确;`l2` 默认空 | — |
| latest-wins | 同 (l1, sid) 两条 note | 取最新 body | ✅ 无唯一约束 |
| 成绩过滤 | l1 上一条 `title:'月考'` grade | 不进 `grades`(只认哨兵 title) | ✅ 未来考核隔离 |
| grade upsert | insert→update 同 (l1, sid) | 同一行被更新,不新增 | ✅ |
| grade 删除 | 三项全空 | 已有行被删,再查为空 | ✅ 成绩非必填 |
| 租户隔离 | 另一 tenant ctx | 读矩阵为空;跨租户写不影响 | ✅ 安全 |
| 空 lessonIds | `[]` | 返回 `{}`,不发非法 inArray SQL | ✅ |

### Edge Cases Checklist
- [x] 空 roster(班级无在读学生)→ 只显示 Summary,无学生行
- [x] 空 lessonIds → loader 提前返回(不触发 `inArray([])` 非法 SQL)
- [x] 成绩三项全空 → 删除成绩行(而非写空行)
- [x] 同一单元格并发/重复保存 → select-then-write 最后写覆盖(与现有 note/attendance 一致)
- [x] 跨班级切换 → keyed Suspense remount,`notesOpenId` 清空,不泄漏上个班级
- [x] 权限:assistant(有 lesson:update)可写;parent/student 到不了 dashboard
- [ ] 超长内容:note body ≤2000、grade comment ≤2000(zod max)——填满不报错、超出被截/提示

---

## Validation Commands

### Static Analysis
```bash
npm run typecheck      # tsc --noEmit
npm run lint           # eslint .
```
EXPECT: 零类型错误、零 lint 错误。

### Unit Tests
```bash
npx vitest run tests/section-notes.test.ts
```
EXPECT: 新增单测全部通过。

### Full Test Suite
```bash
npm run test           # vitest run（全量,防回归）
```
EXPECT: 无回归(尤其 report-db / tenant-isolation 仍绿)。

### Database Validation
```bash
npm run db:generate    # 应无新迁移生成（本功能不改 schema）
```
EXPECT: **不产生任何新迁移**(复用 note、grade 表)。若生成了迁移 = 有人误改了 schema,需排查。

### Browser / E2E Validation
```bash
npm run db:seed:e2e
npm run test:e2e -- tests/e2e/dashboard/teach-notes.spec.ts
```
EXPECT: 展开→保存→成功提示 全流程通过。

### Manual Validation
- [ ] `/dashboard/teach/<section>?tab=lessons` 每个课节行有「笔记点评」展开开关
- [ ] 展开后:Summary 一栏 + 每个在读学生一行(点评 + 成绩)
- [ ] 保存 Summary / 点评 / 成绩 各自出现绿色成功提示,刷新页面后值仍在(已落库)
- [ ] 成绩留空并保存 → 不报错(若之前有值则被清除)
- [ ] 整行 title 点击仍能打开原 `LessonDetail` 抽屉(出勤/取消/改地点)
- [ ] 助教账号可编辑;班级无学生时只显示 Summary

---

## Acceptance Criteria
- [ ] 所有 Task 完成
- [ ] 全部 Validation Commands 通过
- [ ] 单测 + E2E 编写并通过
- [ ] 零类型错误、零 lint 错误
- [ ] 无新数据库迁移(schema 未改)
- [ ] UI 与 After 设计一致(排课 tab 行内展开 Summary+点评+成绩)

## Completion Checklist
- [ ] 代码遵循已发现模式(server-only loader / 'use server' 4 步 / forTenant spine / useTransition+本地 state)
- [ ] 错误处理与库内风格一致(zod.parse、requirePermission、select-then-write)
- [ ] 提示反馈遵循库内约定(useFlash / 绿色成功文案)
- [ ] 测试遵循 report-db.test.ts / schedule.spec.ts 范式
- [ ] 无硬编码时区(用 APP_TIME_ZONE)、无硬编码值
- [ ] grade 权限映射决策已在代码注释说明(lesson:update)
- [ ] 无非必要范围扩张(见 NOT Building)
- [ ] 自包含 —— 实现期间无需再查代码库或提问

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `'use server'` 文件误导出常量(QUICK_GRADE_TITLE)→ Next 报错 | 中 | 中 | 常量放 data.ts(server-only),grade-actions import;Task 2 GOTCHA 已标注 |
| 直接单测 `'use server'` action 因无 session 失败 | 中 | 中 | 分层:core 接 ctx(放 data.ts)供单测,action 薄壳交 E2E;Task 6 GOTCHA |
| 成绩多考核模型(月考/期中)与"单成绩单元格"冲突 | 低 | 中 | 哨兵 title `课堂表现` 隔离行内成绩,多考核明确排除(NOT Building) |
| 课节很多时矩阵一次性加载偏重 | 低 | 低 | note/grade 均走 (tenant, lessonId) 索引 + inArray;`getSectionLessons` 已限窗(term 或 now-60d…+120d);默认折叠、展开才渲染编辑器 |
| 行内区与抽屉双份笔记编辑器 → 同会话内不同步 | 低 | 低 | 二者同读 note 表 + 本地乐观 state;页面导航重新 SC 播种;有意重叠已在 NOT Building 说明 |
| 定制版 Next 有 breaking changes | 低 | 中 | 仅用库内已反复使用的原语,照抄现有文件;新 API 前读 node_modules/next/dist/docs |

## Notes
- **数据直连进度报告**:`src/lib/report-data.ts` 已读取 student-scoped `note`(点评喂给 AI 叙述,79-82 行)与 `grade.comment`/`score`(84-89 行)。本功能录入的点评与成绩会**自动**进入学生进度报告的数据源——这是"统一管理"的下游价值,无需额外接线。
- **为何不新增 tab**:用户明确选择"扩展排课 tab 行内展开",与现有"整行点击打开抽屉"互补(抽屉管出勤/取消/改地点,行内区管笔记/点评/成绩)。
- **为何无迁移**:`note`(shared=studentId null / comment=studentId set)与 `grade`(score/maxScore/comment/title/gradedBy/gradedAt)现有列已满足全部需求。
- **权限决策**:成绩无独立 permission statement(permissions.ts 只有 student/course/lesson/rescheduleRequest/creditPackage/report)。课堂成绩按课节记录 → 归 `lesson:update`,与出勤/笔记的映射一致(attendance-actions.ts:57 明确注释"attendance & notes map to `lesson` permissions")。
- **时区一致性**:课节时间显示复用 section-lessons.tsx 现有的 `APP_TIME_ZONE` 格式化(America/Toronto,单一真相源 `src/lib/timezone.ts`),行内区不额外处理时间。
```
