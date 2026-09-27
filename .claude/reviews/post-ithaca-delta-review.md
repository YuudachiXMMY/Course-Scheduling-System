# orch-review — post-`prod/ithaca` 增量审查

- **范围**: `origin/prod/ithaca...HEAD`(merge-base `0ec21d7`)— 19 提交, 65 文件, +11446/-579(可审代码 ~2875 增行,已排除 drizzle 生成的 meta 快照)
- **方法**: ECC 分片多维审查 + 3 视角对抗验证(自定义工作流 `orch-review-sharded`,复刻 ecc:orch-review 语义;reviewer 自行 `git diff` 取分片 diff,规避 114k-token diff 内联)
- **规模**: 5 分片 × (code-reviewer + 语言 reviewer + security-reviewer[+ database-reviewer]) = **17 reviewer**;对每个 CRITICAL/HIGH 做 3 视角(correctness / security / reproduce)对抗验证 = 12 verifier。**29 agent 全部成功,0 维度失败**。
- **判定**: 🔴 **CHANGES_REQUESTED** — 2 个确认 HIGH blocker(fail-closed;无未决/未验证项),5 条 advisory。

---

## 🔴 BLOCKER 1 — `cancelLessonsAction` 用冻结的 `lesson.teacherId` 授权,被移除的教师仍能批量取消该班课节

- **严重度**: HIGH(RBAC / 越权写)
- **位置**: `src/app/dashboard/schedule/actions.ts:77-80`
- **发现来源**: 4 个 reviewer 实例,横跨 **rbac** 与 **sched** 两个独立分片(rbac:security / sched:quality / sched:lang / sched:security / sched:db)——交叉印证
- **对抗验证**: correctness `isReal@0.9` · security `isReal@0.9` · reproduce `isReal@0.92-0.95`(3/3 视角确认)

**证据**
```ts
const scope = and(
  inArray(lesson.id, unique),
  ne(lesson.status, 'canceled'),
  isWholeTenantActor(ctx) ? undefined : eq(lesson.teacherId, ctx.userId),  // ← 冻结列
)
const rows = await forTenant(ctx).updateWhereMany(lesson, scope, { status: 'canceled' })
```

**根因**
`lesson.teacherId` 在 materialize 时从 `section.teacherId` 反规范化一次,之后永不更新(`src/auth/scope.ts` `actorOwnsLesson` 注释、`materialize.ts:141`、`lesson-insert.ts` 均如此)。本次 PR 新增的 `removeSectionTeacher`(`section-teacher-actions.ts`)**首次**让 section 的 `teacherId` 可在建成后被改指/撤销,但只改 `sectionTeacher` 与 `classSection`,**不动已 materialize 的 lesson 行**——`lesson.teacherId` 保持陈旧。本次 PR 已把 `cancelLessonAction`(:50 用 `actorOwnsLesson`)、`updateLessonAction`、`cancelSeriesAction`(用 `actorOwnsSectionById`)、`rescheduleLessonCore` 全部改为解析**当前** section 归属;**唯独 `cancelLessonsAction` 漏改**,仍直接过滤 `eq(lesson.teacherId, ctx.userId)`。

**利用链**
1. Admin 建 section S,主教师 = A;materialize 产出 L1..Ln,`lesson.teacherId = A`。
2. Admin 加入协同教师 B,再 `removeSectionTeacher({sectionId:S, userId:A})`——删除 A 的 link 并把 `classSection.teacherId` 改指 B。A 对 S 的其余所有路由现已被正确拒绝。
3. A 仍持租户级 `teacher` 角色(`lesson:update` 是**角色级**授权,非按 section,见 `permissions.ts`),故 `requirePermission(ctx,{lesson:['update']})` 仍通过。
4. A 直接 POST 调用 Server Action `cancelLessonsAction([L1,...,Ln])`。因 L1..Ln 的 `lesson.teacherId` 仍冻结为 A,WHERE `teacher_id = A AND status <> 'canceled'` 命中全部 → `updateWhereMany` 全部 tombstone。**被显式移除的前教师仍能批量删除该班全部排课**。
   - 同样这些 id 走单条 `cancelLessonAction` 会被 `actorOwnsLesson` 拒绝 —— 证实批量路径绕过了本 PR 引入的修复。
   - 租户隔离(`forTenant`)完好,越过的是 **section 级授权边界**。

**测试缺口**: `tests/add-sessions.test.ts` 只覆盖"从未关联该 section 的无关教师被拒",未覆盖"materialize 时曾是 teacherId、之后被移除"的教师 —— 此漏洞无测试。

**建议修复**
按 sibling 一致地以**当前** section 归属收窄:先解析 `ctx.userId` 当前拥有的 section id 集合(`sectionIdsForActor(ctx)`),`scope` 加 `inArray(lesson.sectionId, ownedSectionIds)`(空集按既有不变式短路),或在 `updateWhereMany` 前对(已去重、上限 500 的)id 集逐个 `actorOwnsLesson` 校验。**不要**再以冻结的 `lesson.teacherId` 作为授权依据。

---

## 🔴 BLOCKER 2 — `addSessionsCore` 的 `isException:true` 行污染 materialize 的按周例外过滤,静默丢弃该周正课

- **严重度**: HIGH(正确性 / 数据丢失)
- **位置**: `src/lib/add-sessions.ts:74-85` × `src/lib/materialize.ts:129-134`
- **对抗验证**: correctness `isReal@0.85` · reproduce `isReal@0.8` · security `isReal:False@0.88`(非安全问题,正确判定)→ 2/3 视角确认为真,保留 blocking

**证据**
```ts
// add-sessions.ts:74-85 —— 手动添加的 ad-hoc 课节
const rows = occurrences.map((o) => ({
  ...,
  originalStartAt: o.originalStartAt,   // ← 非空
  status: 'scheduled' as const,
  isException: true,                    // ← 同时置 true
  ...
}))
```
```ts
// materialize.ts:129-134 —— 只有"真正的改期例外"才应压制某周的新 pattern occurrence
const exceptionWeeks = new Set(
  existingLessons
    .filter((l) => l.isException && l.originalStartAt != null)   // ← add-sessions 行正好命中
    .map((l) => isoWeek(l.originalStartAt!)),
)
const freshOccurrences = occurrences.filter((o) => !exceptionWeeks.has(isoWeek(o.originalStartAt)))
```

**根因**
`materialize.ts` 的 F6 修复本意:只让"真正的改期例外"(`isException=true` 且 `originalStartAt` 保留原 RECURRENCE-ID)压制某周;并特意排除 `scheduleLessonCore` 的临时课(`isException=true` 但 `originalStartAt=NULL`)。但 `addSessionsCore` 产出的行是**混血**:`isException=true`(像临时课)**且** `originalStartAt` 非空(像改期例外)——因此命中 `isException && originalStartAt != null` 谓词,把该 add-sessions 课节所在的 ISO 周塞进 `exceptionWeeks`。

**触发场景**
section 每周一上课;用户用"添加课节"在**同一周的周三**加了一节 → 该周三 add-sessions 行的 ISO 周进入 `exceptionWeeks`。此后一次 `updateSection`(清除未来 pattern 行、保留例外、再 re-materialize)时,`freshOccurrences` 会因该周已在 `exceptionWeeks` 而**过滤掉周一的正课 occurrence** → 周一课节被永久删除且无报错。

**建议修复**
不要让 add-sessions 行参与 materialize 的例外压制:给"额外新增课节"用独立标志(而非 `isException`);或让 `exceptionWeeks` 额外要求被压制行的 weekday/time 匹配 section 自身的 meeting slot(只压制它能真正顶替的 occurrence);或给 add-sessions 独立的去重键。

---

## 🟡 ADVISORY(5,非阻断)

| # | 严重度 | 位置 | 问题 |
|---|--------|------|------|
| A1 | MEDIUM | `section-teacher-actions.ts:132` | 意外 DB 故障时原始错误消息透传给客户端(CWE-209),与 sibling 的 `toPortalActionError` 模式不一致 |
| A2 | LOW | `auth/roles.ts:56` | 陈旧注释:`hasWholeTenantRole` 文档仍把 assistant 列为 whole-tenant |
| A3 | LOW | `section-teacher-actions.ts:163` | `addSectionTeacher`/`removeSectionTeacher` 意外错误时透传原始异常消息 |
| A4 | MEDIUM | `lib/ical-feed.ts:92` | `getFeedLessons` 新增的 section_teacher 成员 scoping 无测试覆盖 |
| A5 | MEDIUM | `courses/page.tsx:115` | 教师 `course:update` 权限被撤后,归档课程的"恢复"控件未随之下线,产生死按钮/静默失败 |

---

## ✅ 审查确认为洁净的面
- **租户隔离**: 全部路径 `tenant_id` 过滤完好(唯一越界是 BLOCKER 1 的 section 级授权,非租户级)。
- **迁移 0022/0023**: database-reviewer 通过。0023 建 `section_teacher` 表 + 幂等回填(`ON CONFLICT DO NOTHING`,`teacher_id IS NULL` 不插行),存量库无 crash-loop / 数据丢失;0022 GiST EXCLUDE 加 `section_id` 放宽约束无问题。
- **ICS 日历订阅 token feed**: 无 token 越权 / 跨租户泄露 blocker(A4 仅为测试缺口)。
- **report-sanitize 拆解 + 6-clone 去重合并**: 行为保持,无回归 blocker。
- **多教师 section + 教师/助教只读 scope**: `actorOwnsSection`/`actorOwnsLesson`/`actorOwnsSectionById` 全部改为解析当前 section —— 正确,**唯一遗漏**即 BLOCKER 1 的 `cancelLessonsAction`。

---

## 下一步(Gate 3,待人工决定)
两个 blocker 修复均为局部、低风险,可作为一个 draft PR 落地(BLOCKER 1 收窄 `cancelLessonsAction` 的 WHERE 至当前 section 归属 + 补越权测试;BLOCKER 2 给 add-sessions 行去掉/区分 `isException` 或收窄 exceptionWeeks),并可顺带清 A1/A3(CWE-209)与 A5(死按钮门控)。**未自动实施**——本次为审查门,等待 Gate 2 决定。
