# Plan: 课程编辑修复 + 选课接线 + 排课日历增强

## Summary
修复三个"后端 action 已就绪但前端零调用"的缺陷（课程/班级无法编辑、学生无法选课、课堂笔记保存后无法查看），并为排课日历新增班级筛选、地点/Zoom 链接编辑、事件显示课程名+学生名、班级多时段（不同日期不同时段）排课，以及每节课"共享笔记 + 每学生独立 comment"的报告模型。

## User Story
As a 机构老师/管理员（tenant 内 owner/admin 角色），
I want 添加后能编辑课程与班级、把学生加入班级、在日历里筛选班级并编辑每节课的地点或网课链接、看到每个事件的课程名和学生名、给一个班级排不同日期的不同时段、并为每节课记录共享笔记与逐学生点评，
So that 我能在一个界面里完成完整的排课与课堂记录闭环，而不是被"只能新建、不能修改"的死路挡住。

## Problem → Solution
当前 `createCourse`/`createSection`/`enrollStudent`/`addNote` 的写入 action 完整存在，但 `updateCourse`/`updateSection`/`enrollStudent`/`unenrollStudent`/`listNotes` **没有任何 UI 调用点**（已 grep 验证，零命中）。课节只能设单一时段、日历事件只显示 `title ?? '课节'`、没有筛选、没有地点/链接编辑、笔记框只 insert 不回显。
→ 补齐缺失的编辑/选课/笔记回显 UI（无 schema 变更即可修复 3 个 bug），并新增 `sectionMeeting` 子表 + `lesson.meetingUrl`/`section.defaultMeetingUrl` 列支撑多时段与网课链接，扩展日历数据管道携带课程名/学生名并加班级筛选。

## Metadata
- **Complexity**: XL（建议拆两阶段：Phase A 无 schema 的 bug 修复；Phase B 含迁移的功能增强）
- **Source PRD**: N/A（free-form 需求）
- **PRD Phase**: N/A
- **Estimated Files**: ~18（新增 ~5，修改 ~13）

---

## UX Design

### Before
```
课程页 (/dashboard/courses)
┌────────────────────────────────────────┐
│ [添加课程]  ← 只能新建，课程卡无编辑按钮  │
│ 课程卡: 高一数学                          │
│   班级列表: 周一班 · FREQ=WEEKLY... [导出] │  ← 班级无编辑、无学生管理
│   [+ 新建班级] ← 单一 startTime，所有选中日同时段 │
└────────────────────────────────────────┘

排课页 (/dashboard/schedule)
┌────────────────────────────────────────┐
│ 拖拽新建课节的班级: [下拉]  ← 不是筛选器   │
│ FullCalendar: 事件只显示 "课节"           │  ← 无课程名/学生名
│ 点事件 → 抽屉: 出勤 + 笔记框(只新增,存后清空,不回显) │  ← 无地点/链接编辑
└────────────────────────────────────────┘
```

### After
```
课程页
┌────────────────────────────────────────┐
│ [添加课程]                                │
│ 课程卡: 高一数学  [编辑] [归档]           │  ← 新增编辑/归档
│   班级: 周一/三班 · 周一16:00 周三18:00 [编辑][管理学生] │  ← 多时段 + 花名册
│      花名册: 张三 [移除]  [＋添加学生 ▾]   │  ← 选课 UI
│   [+ 新建班级] → 可添加多行"上课日+时间+时长"时段 │
└────────────────────────────────────────┘

排课页
┌────────────────────────────────────────┐
│ 排课班级(拖拽用): [下拉]                   │
│ 显示筛选: ☑周一班 ☑周三班 ☐已结班 ...     │  ← 多选筛选显示
│ FullCalendar: "高一数学 · 张三,李四" @线上 │  ← 课程名+学生名+地点
│ 点事件 → 抽屉:                            │
│   出勤 | 地点[____] 网课链接[____][保存]    │  ← 可编辑地点/Zoom
│   本节课笔记[回显+可改][保存]              │  ← 共享笔记回显可改
│   逐学生点评: 张三[____] 李四[____]        │  ← 每学生 comment
└────────────────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| 课程卡 | 无操作 | 编辑标题/科目/级别/时长、归档 | 复用 `updateCourse`/`archiveCourse` |
| 班级行 | 只有导出 | 编辑班级、管理学生花名册 | 复用 `updateSection`/`enrollStudent` |
| 新建/编辑班级 | 单一时段 | 多行时段（不同日不同时间） | 需 `sectionMeeting` 子表 |
| 日历顶部 | 单选下拉（排课用） | 保留下拉 + 新增班级显示筛选 | 客户端过滤 events |
| 日历事件 | "课节" | "课程名 · 学生名" + 地点/线上标记 | data 管道 join |
| 课节抽屉 | 笔记只新增不回显 | 地点/链接可编辑；共享笔记回显可改；逐学生点评 | 新 `updateLessonAction` + 笔记 upsert |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/db/tenant.ts` | 1-55 | **唯一**合法的 tenant 数据访问入口 `forTenant(ctx)`：`select/findById/insert/update/delete`。所有 DB 操作必须走它，禁止裸 `db.*`（materialize 里的批量 insert 是唯一例外且已注释说明） |
| P0 | `src/app/dashboard/courses/actions.ts` | 1-180 | 课程/班级 action 全貌；`updateCourse`(46)/`updateSection`(146) 已存在；`createSection` 用 `safeParse`+返回 `CreateSectionResult` 的错误即数据模式（防 React #441） |
| P0 | `src/app/dashboard/schedule/attendance-actions.ts` | 1-134 | `getLessonRoster`/`addNote`(112)/`listNotes`(126)；note 表支持 `lessonId`+`studentId` |
| P0 | `src/lib/materialize.ts` | 1-97 | RRULE→lesson 物化；多时段需在此循环展开每个 meeting；注意 `onConflictDoNothing` + GiST 冲突回退 |
| P0 | `src/lib/schedule-core.ts` | 21-135 | `toEvent`(21) 定义事件字段；createLesson 冲突逻辑；新增 location/meetingUrl 编辑需类比 |
| P1 | `src/db/schema/course.ts` | 1-84 | `classSection` 结构（rrule/recurrenceDtstart/defaultLocation）；新增 `defaultMeetingUrl` 及 `sectionMeeting` 子表参照此文件的 composite-FK 写法 |
| P1 | `src/db/schema/lesson.ts` | 1-70 | `lesson` 结构；新增 `meetingUrl` 列；注意 `uq_lesson_section_slot` 幂等键 |
| P1 | `src/db/schema/note.ts` | 1-55 | note 已支持 `lessonId`/`studentId`/`authorId`/`visibility`；req7/req8 全靠它 |
| P1 | `src/app/dashboard/schedule/lesson-detail.tsx` | 1-151 | 课节抽屉；req5/7/8 主战场；`saveNote`(53) 存后 `setNoteBody('')` 是 bug 现象 |
| P1 | `src/app/dashboard/schedule/calendar.tsx` | 1-116 | FullCalendar 客户端；顶部 `select` 是排课用非筛选；req4/6 主战场 |
| P1 | `src/app/dashboard/courses/section-form.tsx` | 1-197 | 班级表单；client 端先校验再调 action 的既定模式；req1(编辑)/req3(多时段) 主战场 |
| P2 | `src/app/dashboard/schedule/data.ts` | 1-31 | `listLessonsInRange` 产出 `CalendarEvent`；req6 需在此 join 课程名/学生名 |
| P2 | `src/app/dashboard/schedule/types.ts` | 1-22 | `CalendarEvent` 契约（跨 server/client）；req6 需扩展字段 |
| P2 | `src/lib/rrule-build.ts` | 1-31 | `buildWeeklyRrule({byDays,until,count})`；多时段每个 meeting 复用 |
| P2 | `src/lib/recurrence.ts` | 1-70 | `expandRecurrence`：floating-time 展开；多时段每 meeting 用各自 wallStart |
| P2 | `src/app/dashboard/schedule/enrollment-actions.ts` | 1-92 | `enrollStudent`/`unenrollStudent`/`listSectionEnrollments`，req2 直接接线 |
| P2 | `src/app/dashboard/students/actions.ts` | all | `listStudents` 供选课下拉；确认导出签名 |
| P2 | `drizzle.config.ts` + `drizzle/*.sql` | all | 迁移工作流：`pnpm db:generate` 生成、`pnpm db:migrate` 应用；snake_case |

## External Documentation
| Topic | Source | Key Takeaway |
|---|---|---|
| FullCalendar 自定义事件内容 | `@fullcalendar/react` v6 `eventContent` 回调 | 用 `eventContent={(arg)=>...}` 或 `extendedProps` 携带 courseName/studentNames；筛选用受控 `events` 数组即可，无需 `eventSources` |
| RFC5545 RRULE 单时段限制 | 现有 `rrule` 2.8.1 | 单条 RRULE+单 DTSTART 只能表达一个 time-of-day → 多时段必须多条 rule（本方案用 `sectionMeeting` 子表，每行一条 rule） |

> 其余为已确立的内部模式，无需外部调研（Drizzle/Zod/Server Actions/Luxon 全部已在库内成熟使用）。

---

## Patterns to Mirror

### SERVER_ACTION_VALIDATION_AS_DATA（防 React #441）
```ts
// SOURCE: src/app/dashboard/courses/actions.ts:95-144
export type CreateSectionResult =
  | { ok: true; section: ClassSection }
  | { ok: false; error: string }

export async function createSection(input: SectionInput): Promise<CreateSectionResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { course: ['create'] })
  const parsed = sectionSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '输入有误' }
  }
  // ...
}
```
> **GOTCHA**：生产环境 Next.js 会把 Server Action 抛出的 ZodError 消息抹成 "Minified React error #441"。任何用户可触发的校验失败必须**返回**为数据，不能 throw。`updateSection`(146) 目前仍用 `.parse()`（会 throw），本计划要求改成同款 `safeParse` + result 模式。

### TENANT_SCOPED_DB
```ts
// SOURCE: src/db/tenant.ts:14-47
const [row] = await forTenant(ctx).update(classSection, id, { name, teacherId, ... })
const rows = await forTenant(ctx).select(enrollment, and(eq(enrollment.sectionId, sid), eq(enrollment.status, 'active')))
const one = await forTenant(ctx).findById(lesson, lessonId)
```
> `update` 会自动剥离 `tenantId`/`id`，`insert` 会强制注入 `tenantId`。**永远不要**对 tenant 表用裸 `db.select().from(...)`（会跨租户泄露）。

### AUTH_GUARD
```ts
// SOURCE: 每个 action 开头统一
const ctx = await requireAuthContext()
requirePermission(ctx, { course: ['update'] }) // 或 { lesson: ['update'] } / { student: ['list'] }
```
> 权限键见 `src/auth/permissions.ts`：`course`/`lesson`/`student` 各有 `list/read/create/update`。选课走 `course:update`（见 enrollment-actions.ts:19），笔记/出勤/地点走 `lesson:update`。

### CLIENT_FORM（useTransition + router.refresh + 客户端预校验）
```ts
// SOURCE: src/app/dashboard/courses/section-form.tsx:42-87
const [pending, startTransition] = useTransition()
const router = useRouter()
function submit() {
  setError(null)
  if (!termStart) { setError('请选择学期开始日期'); return } // 先客户端校验
  startTransition(async () => {
    const result = await createSection({ ... })
    if (!result.ok) { setError(result.error); return }
    router.refresh()
  })
}
```

### REVALIDATE
```ts
// SOURCE: 所有写 action 结尾
revalidatePath('/dashboard/courses') // 或 '/dashboard/schedule'
```

### MATERIALIZE_EXPAND（多时段循环参照）
```ts
// SOURCE: src/lib/materialize.ts:43-64
const dt = DateTime.fromJSDate(section.recurrenceDtstart).setZone(zone)
const occurrences = expandRecurrence({
  rruleText: section.rrule,
  wallStart: { year: dt.year, month: dt.month, day: dt.day, hour: dt.hour, minute: dt.minute },
  zone, durationMinutes: duration, windowStart, windowEnd,
})
const rows = occurrences.map((o) => ({
  tenantId: ctx.tenantId, sectionId: section.id, teacherId: section.teacherId,
  startAt: o.startAt, endAt: o.endAt, originalStartAt: o.originalStartAt,
  status: 'scheduled' as const, location: section.defaultLocation,
}))
```

### CHILD_TABLE_COMPOSITE_FK（新增子表参照）
```ts
// SOURCE: src/db/schema/enrollment.ts:9-45 / course.ts classSection
foreignKey({
  columns: [t.tenantId, t.sectionId],
  foreignColumns: [classSection.tenantId, classSection.id],
  name: 'fk_meeting_section',
}).onDelete('cascade'),
```

### CALENDAR_EVENT_MAPPING
```ts
// SOURCE: src/lib/schedule-core.ts:21-30  &  src/app/dashboard/schedule/data.ts:23-30
return rows.map((r) => ({
  id: r.id, title: r.title ?? '课节',
  start: r.startAt.toISOString(), end: r.endAt.toISOString(),
  sectionId: r.sectionId, status: r.status,
}))
```

### TEST_STRUCTURE
```ts
// SOURCE: tests/materialize.test.ts / tests/recurrence.test.ts（vitest, 纯函数优先）
// 纯逻辑（rrule 构建、多时段展开、笔记合并）走单测；action 走现有集成测试布局
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/db/schema/course.ts` | UPDATE | `classSection` 加 `defaultMeetingUrl`；新增 `sectionMeeting` 子表 |
| `src/db/schema/lesson.ts` | UPDATE | 加 `meetingUrl text` 列（req5 网课链接） |
| `src/db/schema/relations.ts` | UPDATE | 加 `sectionMeeting` 关系 |
| `src/db/schema/index.ts` | UPDATE | barrel 导出 `sectionMeeting` |
| `drizzle/00XX_*.sql` | CREATE | `pnpm db:generate` 生成迁移（勿手写） |
| `src/lib/rrule-build.ts` | 复用 | 无需改（每 meeting 调一次） |
| `src/lib/materialize.ts` | UPDATE | 遍历 `sectionMeeting` 逐条展开；无 meeting 时回退旧 `section.rrule`（向后兼容） |
| `src/app/dashboard/courses/actions.ts` | UPDATE | `updateSection` 改 safeParse+result；`createSection`/`updateSection` 接受 `meetings[]`；写 `defaultMeetingUrl` |
| `src/app/dashboard/courses/course-form.tsx` | UPDATE | 支持编辑态（接收可选 `course`，调 `updateCourse`）——参照 `student-form.tsx` 的 create/edit 双模式 |
| `src/app/dashboard/courses/section-form.tsx` | UPDATE | 支持编辑态 + 多时段行（meetings）+ 网课链接 |
| `src/app/dashboard/courses/section-roster.tsx` | CREATE | 班级花名册管理（列出/添加/移除学生）→ req2 |
| `src/app/dashboard/courses/page.tsx` | UPDATE | 课程卡加"编辑/归档"；班级行加"编辑/管理学生"；传 students 列表 |
| `src/app/dashboard/schedule/data.ts` | UPDATE | join 课程 title + 该 section 在读学生名 → 填充事件 |
| `src/app/dashboard/schedule/types.ts` | UPDATE | `CalendarEvent` 加 `courseTitle`/`studentNames`/`location`/`meetingUrl` |
| `src/app/dashboard/schedule/calendar.tsx` | UPDATE | 加班级显示筛选（多选）；`eventContent` 渲染课程名+学生名 |
| `src/app/dashboard/schedule/actions.ts` | UPDATE | 新增 `updateLessonAction`（location/meetingUrl/title） |
| `src/app/dashboard/schedule/attendance-actions.ts` | UPDATE | 笔记改 upsert：`upsertSharedNote`(lessonId,studentId=null) + `upsertStudentNote`(lessonId,studentId)；`getLessonNotes` 返回 {shared, perStudent[]} |
| `src/app/dashboard/schedule/lesson-detail.tsx` | UPDATE | 回显+可改共享笔记；逐学生 comment；地点/Zoom 编辑区 |
| `tests/materialize.test.ts` | UPDATE | 多时段展开断言 |
| `tests/lesson-notes.test.ts` | CREATE | 共享笔记 upsert + 逐学生 comment 合并逻辑 |

## NOT Building
- ❌ 不做家长 portal 侧的多时段/笔记展示改造（portal 只读，另立需求）
- ❌ 不改 MCP 工具（`src/mcp/*`）的 note/schedule 接口（除非 typecheck 因 core 签名变动强制，最小改动）
- ❌ 不做课程/班级的硬删除（沿用 `archiveCourse` 软归档；班级无删除按钮，保持现状）
- ❌ 不引入富文本/附件笔记；comment 仍是纯文本
- ❌ 不做 Zoom OAuth/自动建会；`meetingUrl` 仅存手工粘贴的链接
- ❌ 不改多租户 RLS 策略、不动 `forTenant` 契约
- ❌ 不做 report PDF（progressReport）与逐课笔记的打通（req8 只到"每节课报告 = 共享笔记 + 学生 comment"的记录层，不生成 PDF）

---

## Step-by-Step Tasks

> 建议实现顺序：先 Phase A（Task 1-4，纯 UI 接线，零迁移，可独立发布），再 Phase B（Task 5-10，含迁移）。

### Task 1: 修复课程可编辑（req1a）
- **ACTION**: 让 `CourseForm` 支持编辑态，课程页课程卡加"编辑/归档"入口。
- **IMPLEMENT**: `course-form.tsx` 接收可选 `course?: Course` prop；有值时初始化字段并调 `updateCourse(course.id, input)`，无值时 `createCourse`。参照 `students/student-form.tsx` 的 create/edit 双模式（`<StudentForm student={s} />`）。`page.tsx` 课程卡右侧渲染 `<CourseForm course={c} />`（编辑）与调用 `archiveCourse` 的归档按钮。
- **MIRROR**: CLIENT_FORM + `student-form.tsx` 双模式。
- **IMPORTS**: `import { createCourse, updateCourse, archiveCourse, type Course } from './actions'`
- **GOTCHA**: `updateCourse` 用 `.parse()` 会 throw，但课程字段简单（仅 title 必填），客户端先校验 title 非空即可；如需更稳可同 Task 3 改 safeParse。
- **VALIDATE**: `pnpm typecheck`；手动：编辑课程标题→保存→刷新后标题更新。

### Task 2: 学生选课花名册 UI（req2）
- **ACTION**: 新建 `section-roster.tsx`，在课程页每个班级行下管理在读学生。
- **IMPLEMENT**: client 组件，props `{ sectionId, capacity, students: {id,name}[] }`。挂载时 `listSectionEnrollments(sectionId)` 拉在读名单（映射学生名）；渲染名单+每人"移除"按钮（`unenrollStudent`）；底部下拉选未在读学生 + "添加"（`enrollStudent`）。用 `useTransition`+`router.refresh()`。`page.tsx` 需 `listStudents()` 并把 `{id,name}[]` 传下去。
- **MIRROR**: CLIENT_FORM；数据拉取参照 `lesson-detail.tsx:32-43` 的 `useEffect`+active 标志。
- **IMPORTS**: `import { enrollStudent, unenrollStudent, listSectionEnrollments } from '../schedule/enrollment-actions'`
- **GOTCHA**: `enrollStudent` 满员/异常会 **throw**（enrollment-actions.ts:41 `throw new Error('班级已满')`）→ 用 try/catch 捕获显示，或后续改 result 模式。容量校验已在 server 侧。
- **VALIDATE**: 手动：把学生加入班级→抽屉出勤名单(`getLessonRoster`)出现该生；超容量报错。

### Task 3: 班级可编辑 + updateSection 改 result 模式（req1b）
- **ACTION**: `section-form.tsx` 支持编辑态；`updateSection` 改用 `safeParse`+返回 `CreateSectionResult`。
- **IMPLEMENT**: `section-form.tsx` 接收可选 `section?: ClassSection`，编辑态预填字段（从 rrule 反解 byDays、从 recurrenceDtstart 反解 startTime/timezone、termStart/End），提交调 `updateSection`。`actions.ts` 的 `updateSection` 复制 `createSection` 的 `safeParse` 分支，返回 `{ok,section}|{ok,error}`。
- **MIRROR**: SERVER_ACTION_VALIDATION_AS_DATA（createSection:111-144）。
- **IMPORTS**: 复用现有。
- **GOTCHA**: 反解 rrule→byDays 需解析 `BYDAY=MO,WE`；反解 startTime 用 `DateTime.fromJSDate(recurrenceDtstart).setZone(tz).toFormat('HH:mm')`。编辑后应触发重新物化（`materializeSectionAction`）——但要避免与已存在 lesson 冲突（materialize 幂等 onConflictDoNothing，旧时段的孤儿 lesson 需另行处理，见 Task 5 GOTCHA）。
- **VALIDATE**: `pnpm typecheck`；手动编辑班级名/时段→保存不报 #441。

### Task 4: 课堂笔记回显 + 可改（req7，与 Task 8 合并落地）
- **ACTION**: `lesson-detail.tsx` 挂载时加载已有笔记并回显，允许修改；`attendance-actions.ts` 笔记改 upsert。
- **IMPLEMENT**: 见 Task 8（req7 与 req8 共用同一套 note upsert + 回显，合并实现避免重复改文件）。
- **VALIDATE**: 见 Task 8。

### Task 5: schema — sectionMeeting 子表 + meetingUrl 列（req3/req5）
- **ACTION**: 新增 `sectionMeeting` 表；`lesson` 加 `meetingUrl`；`classSection` 加 `defaultMeetingUrl`。
- **IMPLEMENT**: 在 `course.ts` 定义：
  ```ts
  export const sectionMeeting = pgTable('section_meeting', {
    id: primaryId(), tenantId: tenantId(),
    sectionId: text('section_id').notNull(),
    byDay: text('by_day').notNull(),        // 'MO'|'TU'...（单个 Weekday）
    startTime: text('start_time').notNull(),// 'HH:mm'
    durationMinutes: integer('duration_minutes').notNull().default(60),
    createdAt: createdAt(), updatedAt: updatedAt(),
  }, (t) => [
    uniqueIndex('uq_meeting_tenant_id').on(t.tenantId, t.id),
    foreignKey({ columns:[t.tenantId,t.sectionId], foreignColumns:[classSection.tenantId,classSection.id], name:'fk_meeting_section' }).onDelete('cascade'),
    index('idx_meeting_tenant_section').on(t.tenantId, t.sectionId),
  ])
  ```
  `classSection` 加 `defaultMeetingUrl: text('default_meeting_url')`；`lesson` 加 `meetingUrl: text('meeting_url')`。更新 `relations.ts`（section→meetings many）、`schema/index.ts` barrel。
- **MIRROR**: CHILD_TABLE_COMPOSITE_FK（enrollment.ts）；`_helpers.ts` 的 `primaryId/tenantId/createdAt/updatedAt`。
- **IMPORTS**: `import { integer } from 'drizzle-orm/pg-core'`（course.ts 已导入大部分）。
- **GOTCHA**: **不要手写迁移 SQL**；跑 `pnpm db:generate` 生成 `drizzle/00XX_*.sql`，再 `pnpm db:migrate`。snake_case 由 config 保证。旧数据无 meeting 行 → materialize 必须回退到 `section.rrule`（向后兼容）。
- **VALIDATE**: `pnpm db:generate` 生成迁移无报错；`pnpm typecheck`。

### Task 6: materialize 支持多时段（req3）
- **ACTION**: `materializeSection` 遍历该 section 的 `sectionMeeting` 行，每行构建 rrule+dtstart 独立展开后合并插入。
- **IMPLEMENT**: 先 `forTenant(ctx).select(sectionMeeting, eq(sectionMeeting.sectionId, sectionId))`。若有 meeting 行：对每行用 `buildWeeklyRrule({byDays:[m.byDay], until})` + 由 `termStartDate`+`m.startTime` 算 `wallStart`，调 `expandRecurrence(...)`，`durationMinutes: m.durationMinutes`，合并所有 occurrences 再走现有 bulk-insert/回退逻辑（每行的 lesson 带各自 `location: section.defaultLocation`）。若无 meeting 行：保持现有 `section.rrule` 路径不变。
- **MIRROR**: MATERIALIZE_EXPAND（materialize.ts:43-64）。
- **IMPORTS**: `import { sectionMeeting } from '@/db/schema'`；`buildWeeklyRrule`/`expandRecurrence` 已在文件内。
- **GOTCHA**: `uq_lesson_section_slot` = `(tenantId, sectionId, originalStartAt)`。多时段同一天不同时间的 `originalStartAt` 不同 → 不会误撞。编辑班级删除某 meeting 后，其历史 lesson 成"孤儿"——本计划**不自动删除**孤儿 lesson（避免误删已上过的课/出勤），仅新增/幂等；在 UI 提示"旧时段的已排课节需手动取消"。
- **VALIDATE**: `tests/materialize.test.ts` 加断言：两个 meeting（周一16:00、周三18:00）→ 生成两组不同时刻的 lesson。`pnpm test`。

### Task 7: 班级表单多时段行 + 网课链接（req3/req5）
- **ACTION**: `section-form.tsx` 把单一"上课日+时间+时长"改为可增删的 meeting 行数组；加"默认网课链接"输入。
- **IMPLEMENT**: state 从 `byDays/startTime/duration` 改为 `meetings: {byDay,startTime,durationMinutes}[]`（默认一行）；"+ 添加时段"追加行，每行可删。提交时传 `meetings` 给 `createSection`/`updateSection`。`actions.ts` 的 `sectionSchema` 用 `meetings: z.array(z.object({ byDay: weekdayEnum, startTime: HHmm正则, durationMinutes: 15..480 })).min(1)` 替换 `byDays/startTime/durationMinutes`，`createSection` 插入 section 后批量插入 `sectionMeeting` 行，再 `materializeSectionAction`。写 `defaultMeetingUrl`。
- **MIRROR**: section-form 现有 toggle/校验模式；SERVER_ACTION_VALIDATION_AS_DATA。
- **IMPORTS**: 复用。
- **GOTCHA**: 保持向后兼容 —— 若坚持最小化，`recurrenceDtstart`/`rrule` 仍可写"第一个 meeting"以兼容旧 materialize 回退路径与 ical。客户端仍需先校验（至少 1 个时段、termStart 非空）防 #441。
- **VALIDATE**: 手动：新建含两时段的班级→日历出现两种时刻的课；`pnpm typecheck`。

### Task 8: 每节课共享笔记 + 逐学生 comment（req7 + req8）
- **ACTION**: 笔记模型落地为"每节课一条共享笔记(studentId=null) + 每学生一条 comment(studentId=set)"，抽屉回显并可改。
- **IMPLEMENT**: `attendance-actions.ts`：
  - `getLessonNotes(lessonId)` → `{ shared: string, perStudent: Record<studentId,string> }`：`listNotes` 拉全部，按 `studentId==null` 分共享，其余按 student 归并（各取最新一条 body）。
  - `upsertSharedNote({lessonId, body})`：select `note where lessonId && studentId IS NULL`，有则 `update` body，无则 `insert`（studentId 省略）。
  - `upsertStudentNote({lessonId, studentId, body})`：select `note where lessonId && studentId`，upsert。
  - 删旧 `addNote` 或保留但 UI 不再用。
  `lesson-detail.tsx`：`useEffect` 里 `getLessonNotes` 回填共享笔记 textarea 与每个 roster 学生的 comment 输入；共享笔记"保存"调 `upsertSharedNote`（**不再清空**）；每学生 comment 各自"保存"调 `upsertStudentNote`。
- **MIRROR**: `upsertAttendance`(attendance-actions.ts:66-96) 的 select-then-update/insert upsert 模式；TENANT_SCOPED_DB。
- **IMPORTS**: `import { note } from '@/db/schema'`（已在文件内）；`isNull` from `drizzle-orm`（共享笔记查 `studentId IS NULL`）。
- **GOTCHA**: note 表无 `(lessonId,studentId)` 唯一约束 → 必须 select-then-write（不能靠 onConflict）。req7 的"保存后清空"根因就是旧 `saveNote` 的 `setNoteBody('')`——务必删除该行并改为回填。共享笔记即 req8 的"共享本节课笔记"，无需复制到每个学生。
- **VALIDATE**: `tests/lesson-notes.test.ts`：共享笔记二次保存是 update 非新增；两个学生各存 comment 互不覆盖；共享笔记对两学生一致。手动：存笔记→关抽屉→重开仍显示且可改。

### Task 9: 日历事件显示课程名 + 学生名（req6）+ 地点/链接编辑（req5）
- **ACTION**: `data.ts` join 课程 title 与在读学生名填入事件；`types.ts` 扩展；`calendar.tsx` 用 `eventContent` 渲染；抽屉加地点/网课链接编辑。
- **IMPLEMENT**:
  - `types.ts` `CalendarEvent` 加 `courseTitle?: string; studentNames?: string[]; location?: string|null; meetingUrl?: string|null`。
  - `data.ts`：查 lesson 后，按 `sectionId` 批量取 `classSection`→`course.title`，按 section 取 active enrollments→student names（`forTenant` 批量 `inArray`），组装进事件（含 `r.location`/`r.meetingUrl`）。
  - `calendar.tsx` `eventContent={(arg)=> <div>{课程名 · 学生名}{线上标记}</div>}`，用 `arg.event.extendedProps`。events 需把这些字段透传（FullCalendar 用 `extendedProps` 或直接放事件对象）。
  - `schedule/actions.ts` 加 `updateLessonAction({id, location?, meetingUrl?, title?})` → `forTenant(ctx).update(lesson, id, {...})` + `revalidatePath`，`requirePermission(ctx,{lesson:['update']})`。
  - `lesson-detail.tsx` 加地点/网课链接输入 + 保存（调 `updateLessonAction`）。
- **MIRROR**: CALENDAR_EVENT_MAPPING；`getLessonRoster` 的 `inArray` 批量取名（attendance-actions.ts:33-38）。
- **IMPORTS**: `import { inArray } from 'drizzle-orm'`；`import { course, classSection, enrollment, student } from '@/db/schema'`。
- **GOTCHA**: N+1 风险 —— 用 `Set` 收集 sectionIds/studentIds 后批量查，别逐 lesson 查。学生名过多时事件标题截断（如取前 3 名 + "等N人"）。`location` 编辑后自动流入 ical-feed / 分享卡片（已消费 `lesson.location`）。
- **VALIDATE**: 手动：日历事件显示"高一数学 · 张三,李四"；编辑地点→保存→事件与学生课表卡同步。

### Task 10: 排课日历班级筛选（req4）
- **ACTION**: `calendar.tsx` 顶部新增班级多选筛选，控制哪些 section 的事件显示。
- **IMPLEMENT**: 现有单选下拉保留（"拖拽新建课节归属班级"），另加一组 checkbox（来自 `sections` prop）表示"显示哪些班级"，默认全选。`events` 传给 FullCalendar 前按选中 sectionId 过滤（`events.filter(e => visible.has(e.sectionId))`）。
- **MIRROR**: `section-form.tsx` 的 toggle 多选 UI（weekday buttons）。
- **IMPORTS**: 复用。
- **GOTCHA**: 过滤在客户端做即可（events 已全量在内存）；新建/拖拽产生的事件仍应遵守筛选可见性。sections prop 已由 page.tsx 传入。
- **VALIDATE**: 手动：取消勾选某班级→其事件从日历消失，重新勾选恢复。

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| materialize 多时段 | section + 2 meetings(MO16:00/60, WE18:00/90) | 生成 MO 16:00–17:00 与 WE 18:00–19:30 两组 lesson | 是（跨时段不撞 slot 键） |
| materialize 无 meeting 回退 | section 有 rrule 无 meeting 行 | 走旧路径正常生成 | 是（向后兼容） |
| upsertSharedNote 幂等 | 同 lesson 存两次共享笔记 | 第二次 update 同一行，非新增 | 是 |
| upsertStudentNote 隔离 | 两学生各存 comment | 互不覆盖；共享笔记两者一致 | 是 |
| getLessonNotes 归并 | 混合 shared + 2 学生 note | `{shared, perStudent:{s1,s2}}` 正确分组 | 否 |
| rrule 反解 byDays | `FREQ=WEEKLY;BYDAY=MO,WE` | `['MO','WE']`（编辑态预填） | 是 |

### Edge Cases Checklist
- [ ] 空输入：班级 0 时段（应拦；至少 1 时段）
- [ ] 满容量选课（enrollStudent throw '班级已满'）
- [ ] 学生已在读再次添加（返回既有 active，不重复）
- [ ] 共享笔记为空字符串（允许清空 vs 拒绝——按现有 `min(1)` 语义拒绝空）
- [ ] 多租户：跨租户 lessonId/sectionId 访问返回空（`forTenant` 保证）
- [ ] 编辑班级删时段后的孤儿 lesson（不自动删，UI 提示）
- [ ] 日历学生名超长截断
- [ ] 网课链接非法（前端可选 URL 校验，后端存原样）

---

## Validation Commands

### Static Analysis
```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
```
EXPECT: 0 type errors / 0 lint errors

### Unit Tests
```bash
pnpm test        # vitest run
```
EXPECT: 全绿，新增 materialize 多时段 / lesson-notes 用例通过

### Database Validation
```bash
pnpm db:generate # 生成 drizzle/00XX_*.sql（勿手写）
pnpm db:migrate  # 应用迁移
```
EXPECT: 迁移文件生成无冲突；`section_meeting`/`lesson.meeting_url`/`class_section.default_meeting_url` 落库

### Browser Validation
```bash
pnpm dev
```
EXPECT: 逐项走 Manual Validation

### Manual Validation
- [ ] 课程卡"编辑"→改标题→保存→刷新生效（req1）
- [ ] 班级"编辑"→改时段→保存不报 #441（req1）
- [ ] 班级"管理学生"→添加学生→出勤名单出现（req2）
- [ ] 新建班级含两个不同日不同时段→日历两组时刻课节（req3）
- [ ] 日历顶部取消勾选某班级→事件隐藏/恢复（req4）
- [ ] 抽屉编辑地点/网课链接→保存→事件+课表卡同步（req5）
- [ ] 事件显示"课程名 · 学生名"（req6）
- [ ] 存课堂笔记→关闭重开→回显可改（req7）
- [ ] 多学生班级：共享笔记两人一致 + 各自 comment 独立（req8）

---

## Acceptance Criteria
- [ ] 8 项需求全部可操作验证通过
- [ ] `pnpm check`（typecheck + lint）通过
- [ ] `pnpm test` 全绿（含新增用例）
- [ ] 迁移经 `db:generate` 生成并 `db:migrate` 成功
- [ ] 无手写 SQL、无裸 `db.*`（tenant 表一律 `forTenant`）
- [ ] 用户可触发的校验失败均"返回为数据"（无 React #441）

## Completion Checklist
- [ ] 遵循 forTenant / requirePermission / revalidatePath 模式
- [ ] 错误处理与库内一致（result 模式优先于 throw）
- [ ] 笔记/选课 upsert 采用 select-then-write（无唯一约束表）
- [ ] 测试遵循 vitest 布局
- [ ] 无硬编码时区外的魔法值（沿用 Asia/Shanghai 常量）
- [ ] 向后兼容：旧无 meeting 的 section 仍能物化
- [ ] 无越界改动（不碰 portal/MCP/RLS 除非 typecheck 强制）

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| 多时段迁移破坏现有 section 物化 | 中 | 高 | materialize 保留无-meeting 回退路径；先在测试库 `db:migrate` |
| 编辑班级后孤儿 lesson 残留 | 高 | 中 | 明确不自动删除，UI 提示手动取消旧时段课节 |
| 日历 join 学生名 N+1 性能 | 中 | 中 | 批量 `inArray` + Set 去重，单租户小规模可接受 |
| `updateSection` 触发重物化与已有出勤/笔记冲突 | 中 | 中 | 幂等 onConflictDoNothing 不覆盖已存在 lesson；改动仅新增 |
| note 表无唯一约束导致并发重复 | 低 | 低 | 单老师低并发；select-then-write 足够；必要时后续加部分唯一索引 |
| Server Action throw 触发 #441（updateSection/enrollStudent） | 中 | 中 | Task3 改 result 模式；enrollStudent 用 try/catch 兜底 |

## Notes
- **根因归纳**：req1/2/7 全是"后端 action 齐全但前端零调用点"（grep 验证 `updateCourse/updateSection/enrollStudent/unenrollStudent/listSectionEnrollments/listNotes/archiveCourse` 均无 UI 调用者）——属接线缺失，非逻辑缺陷，Phase A 可低风险快速交付。
- **req8 建模决策**：复用现有 `note` 表（`lessonId`+可空 `studentId`），共享笔记=studentId 为 null 的行，学生 comment=studentId 非空的行。无需新表、无需改 progressReport（后者是 per-section 学期报告，与 per-lesson 记录正交）。
- **req3 建模决策**：单条 RFC5545 RRULE + 单 DTSTART 无法表达"不同日不同时段"，故引入 `sectionMeeting` 子表（每行一个"上课日+时刻+时长"），materialize 逐行展开。**保留单一 section = 单一花名册**的语义（优于"每时段拆成独立 section"的方案，后者会割裂选课与逐课报告）。已在 Alternatives 中记录被否方案。
- **Alternatives Considered（req3）**：① 每个时段建独立 classSection —— 否，割裂 enrollment/report，学生要多次选课；② 在 section 上存多条 rrule 字符串 —— 否，破坏 ical/materialize 的单 rrule 假设且难查询。选定子表方案。
- **地点/链接联动**：`lesson.location` 已被 `ical-feed.ts`/`share.ts`/`schedule-card.tsx` 消费，Task9 的地点编辑天然同步到家长课表卡与订阅日历，无需额外改动。
