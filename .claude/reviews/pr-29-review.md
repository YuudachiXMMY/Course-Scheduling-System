# PR Review: #29 — fix(timezone): 统一所有时间显示为多伦多时区 (America/Toronto)

**Reviewed**: 2026-09-16
**Author**: YuudachiXMMY (Jadyn Wu)
**Branch**: worktree-tz-toronto → main
**Decision**: COMMENT (draft PR) — no CRITICAL/HIGH; approve-equivalent once the migration deploy note is acknowledged

## Summary

系统性地将全应用的墙上时间时区从 `Asia/Shanghai` 统一到 `America/Toronto`,引入唯一事实源 `src/lib/timezone.ts` 的 `APP_TIME_ZONE` 常量。改动干净、方向正确:所有展示走 Luxon + `APP_TIME_ZONE`,无原生本地时区格式化;typecheck / lint 通过,展示层与循环展开测试全绿。唯一需要「有意识拍板」的是迁移对已有班级的一次性重锚(已在 PR 描述披露)。

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM

**M1 — 迁移会重锚已有班级未来的物化时间(有意为之,但有真实行为后果)**
`drizzle/0009_omniscient_riptide.sql:4` 的 `UPDATE class_section SET recurrence_timezone='America/Toronto' WHERE recurrence_timezone='Asia/Shanghai'` 会把每个现存班级翻到多伦多。已物化的课节保持其 UTC 绝对时刻不变(例如原「16:00 上海」= 08:00Z,现渲染为「03:00 多伦多」),但同一班级**未来再次物化**时,新出现的课节会锚定到「16:00 *多伦多*」(冬季 21:00Z)。后果:一个长期班级内,历史课节与新物化课节可能落在不同的绝对时刻 / 不同的显示墙上时间。这是用户明确批准的意图,且已在 PR 的「⚠️ 部署注意」披露。**无需改代码** —— 记录于此以确保这是有意识的部署决策,而非上线后的意外。若有班级需保留 `Asia/Shanghai`,合并前需收紧迁移 `WHERE`。

### LOW

**L1 — 三个业务逻辑测试仍以 `Asia/Shanghai` 作为 fixture 时区**
`tests/recurrence.test.ts:6`、`tests/materialize.test.ts:55,152`、`tests/section-meeting-expansion.test.ts:11`。它们**显式传入**该时区,自洽通过(传 Shanghai → 断言 08:00Z),验证的是「与时区无关的转换机制」——保留一个 no-DST 时区的覆盖其实是有益的。但它们已与 app 默认值、与已迁移的展示层测试分叉,阅读者可能误以为 app 仍默认上海。可选:加一行注释说明「此处刻意用固定偏移时区测试机制」,或将其一改为多伦多以覆盖 DST 场景。**非必须。**

**L2 — 纯函数测试在 import 期即耦合 env/DB**
`tests/ical-feed.test.ts` / `tests/schedule-card.test.ts` 因传递性 import `@/db`(`src/db/index.ts:7` 在模块加载即校验 `DATABASE_URL`)而需要 `DATABASE_URL`;`tests/mcp-tools.test.ts` 需要完整校验的 env(`@t3-oss/env-core`)。这导致纯展示/composer 断言在裸 worktree 里无法运行,审查时需注入占位 `DATABASE_URL` 才能跑绿。**预存结构耦合,非本 PR 引入。** 因此 `composeParentMessage` 的 03:00/04:00 改动在本 worktree 由推理验证(2026-03-02 处于夏令时前,EST −5,`Date.UTC(2026,2,2,8)`=08:00Z → 03:00 Toronto),而非执行验证。

**L3(nit)— `materialize.ts:27` 的 `?? APP_TIME_ZONE` 为死分支**
`recurrence_timezone` 列为 `NOT NULL DEFAULT`,`section.recurrenceTimezone` 永不为 null,`??` 回退实际不可达。无害的防御式代码,行为不变。**无需处理。**

## DST 正确性核对(测试断言)

| Fixture | 日期 | Toronto 偏移 | UTC→local | 断言 | 判定 |
|---|---|---|---|---|---|
| ical-feed / schedule-card | 2026-01-05 | EST −5 | 08:00Z→03:00 | 03:00 / 04:00 | ✓ |
| composeParentMessage | 2026-03-02 | EST −5(3/8 才入夏令时) | 08:00Z→03:00 | 03:00 / 04:00 | ✓ |
| cardWindow snap | 2026-06-15 | EDT −4 | 午夜=04:00Z | getUTCHours=4 | ✓ |

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass (`tsc --noEmit` clean) |
| Lint | Pass (`eslint .` clean) |
| Tests (display/composer 纯函数) | Pass — ical-feed 7/7 + schedule-card 12/12(需占位 `DATABASE_URL`);recurrence 4/4 + section-meeting-expansion 2/2 |
| Tests (DB 集成 / 完整 env) | Skipped — 裸 worktree 无 `.env`/live Postgres(预存限制,非本 PR) |
| Build | Skipped — 未在 worktree 运行(定制版 Next.js;typecheck 已覆盖类型层) |

## Files Reviewed

- `src/lib/timezone.ts` — Added(唯一事实源常量)
- `src/lib/{conflict,ical-feed,materialize,recurrence,schedule-card,schedule-core}.ts(x)` — Modified(ZONE→APP_TIME_ZONE)
- `src/mcp/{message,register-tools}.ts` — Modified
- `src/app/dashboard/schedule/{calendar,data,types}.ts(x)` — Modified
- `src/app/dashboard/courses/{actions,section-form}.ts(x)` — Modified
- `src/app/dashboard/teach/[sectionId]/{data,section-lessons,tabs/reports-panel}.ts(x)` — Modified
- `src/app/dashboard/reschedule/review-panel.tsx`、`src/app/portal/reschedule/request-form.tsx` — Modified
- `src/db/schema/course.ts` — Modified(列默认值,保留字面量供 drizzle-kit)
- `drizzle/0009_omniscient_riptide.sql` + `drizzle/meta/*` — Added/Modified(默认值变更 + 数据迁移)
- `tests/{ical-feed,schedule-card,mcp-tools}.test.ts` — Modified(断言更新到多伦多墙上时间)
