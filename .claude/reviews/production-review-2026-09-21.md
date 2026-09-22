# 生产就绪审查报告 — 全代码库

- **日期:** 2026-09-21
- **范围:** `review all for production` — 整个应用(非 diff),当前 `main`(HEAD `9038c24`,与 origin 同步)
- **方法:** 8 维并行审查 → 跨维去重定级 → 对每个 HIGH/CRITICAL 做双镜头对抗性验证(复现派 vs 已缓解派)
- **规模:** 23 个 agent / 2.32M token / ~25 分钟;17 条原始发现去重后 17 条唯一;7 条 HIGH/CRITICAL 进入对抗验证
- **前置:** 前四轮审计(#64–#67)已修大量问题;本轮只报「当前 main 上仍存活」的缺陷

---

## 结论:Launch-capable with caveats

- **跨租户安全面:零确认漏洞。** `forTenant` + CI 守卫、公开 token 路由(/s、/sec、/api/calendar/[token])、MCP 连接器、导出/报告路由、staff/RBAC、门户家长/学生作用域 —— 全部经审查未发现跨租户泄漏。
- **上线前应修的确认阻断项(3 条):** F6(常规操作触发的永久数据丢失)、F1(同租户内越权读取他教师学生 PII + 持久分享链接)、F4(存量库 DR/升级时迁移崩溃循环)。
- **次级确认缺陷(3 条):** F7(面板崩溃 + 表单丢失)、F2、F5(数据完整性,验证者判 MEDIUM)。
- **对抗验证击杀 1 个假阳性:** F3(Zip-Slip)—— `safe()` 确实不过滤 `..`,但 `archiver@8.0.0` 的 `sanitizePath` 会剥离前导 `../`(实测确认),漏洞无法触发。仅剩注释与库行为不符的文档瑕疵。

> 对全新部署(空库)+ 主 Coolify/IthacaServer(Traefik TLS 边缘)路径:F4 不触发、F3 不成立。真正在正常使用中会咬人的是 **F6**,涉 PII 敏感的是 **F1**。

---

## 阻断项(确认,建议上线前修)

### F6 — `materializeSection` 把临时课当作 pattern 例外,静默删除周期课 【HIGH · 确认】
- **文件:** `src/lib/materialize.ts:114-119`
- **裁定:** 复现镜头因 schema 重试失败;已缓解镜头深入验证(含 luxon ISO 周计算)→ **CONFIRMED HIGH**,未能反驳。
- **机理:** B47 去重用 `isoWeek(l.originalStartAt ?? l.startAt)` 构建 `exceptionWeeks`,但 `scheduleLessonCore`(`schedule-core.ts:97`)插入的临时课 `isException=true` 且 `originalStartAt=NULL`,`?? l.startAt` 兜底会用临时课自身时间凭空占用整周,压制该周的周期课。`updateSection` 先 `clearFutureScheduledLessons`(删未来 pattern 课、保留临时课)再重新物化 → 被删的周期课永不重建 = **永久丢失**。
- **失败场景:** 周一 16:00 周期课的班级,老师在周四加一节补课(同 ISO 周),之后编辑班级保存 → 该周周一的正课从日历/feed/报告中永久消失,无法记考勤,无报错。多日班级(周一+周三)整周正课全没。
- **修复:** `exceptionWeeks` 过滤掉临时课:`existingLessons.filter(l => l.isException && l.originalStartAt != null)`,去掉 `?? l.startAt` 兜底;补回归测试。

### F1 — `enrollStudent` 缺 studentId 对象级鉴权,section 教师可自授他教师学生的持久可见性 【HIGH · 确认】
- **文件:** `src/app/dashboard/schedule/enrollment-actions.ts:19-38`
- **裁定:** 复现镜头 → **CONFIRMED HIGH**(完整逐链核实);反驳镜头因 schema 重试失败。
- **机理:** 只校验 `requirePermission(course:update)` + `actorOwnsSection`(调用者教这个 section),从不校验 `studentId` 是否在其可及范围。唯一 DB 约束是 `(tenantId,studentId)` 复合 FK —— 只保证同租户,不保证同名册。插入后 `studentIdsForActor()` 从此包含该学生,而 `getStudent`/report-core/导出/`getOrCreateShare` 全部以此为门 → 教师 A 可读教师 B 私有学生的家长 PII(`parentWechat/parentPhone/parentEmail`)、报告、导出、并铸造持久 `/s/{token}` 公开链接(即便之后退课,token 仍存活)。
- **同类前例:** 团队已在 `grade-actions.ts` 修过同一类(注释 `B31`),但从未应用到 enrollment 写路径 —— 恰恰是「铸造」那层门所依赖的所有权关系的地方。测试仅覆盖「不能报进他人 section」,未覆盖「不能把他人学生报进自己 section」。
- **修复:** 写入前要求 `isWholeTenantActor(ctx)` 或 `studentId ∈ studentIdsForActor(ctx)`,否则返回「无权添加该学生」;同时收窄 `unenrollStudent`。

### F4 — 迁移 0015 房间冲突 GiST EXCLUDE 无接入部署的预清洗,存量库崩溃循环 【HIGH · 确认】
- **文件:** `drizzle/0015_lesson_room_exclusion.sql:6-13`
- **裁定:** 复现 + 反驳双镜头均 **CONFIRMED HIGH**(最强确认)。
- **机理:** EXCLUDE 约束无 `NOT VALID` 路径,裸 `ALTER TABLE` 必做全量校验扫描;0015 前应用层从无房间冲突检查(`schedule-core.ts` 只查教师冲突),故存量库存在同 `tenant_id`+`location`+时间重叠的行属正常。`scripts/cleanup-room-overlaps.ts` 存在且注释指向 0015,但**全仓 grep 确认它未接入 Dockerfile/entrypoint/compose/package.json** —— 与已接入 entrypoint 的孪生 `cleanup-orphan-tenants.ts`(修 0016)形成不对称。`migrate.ts` 失败 `process.exit(1)` + entrypoint `set -e` + compose `restart: unless-stopped` → 崩溃循环。
- **失败场景:** 恢复 0015 前的备份 / 升级存量库,两个班级都默认 `location='Room A'` 且时段重叠 → 迁移到 0015 抛 `23P01` → 引导中止 → 每次重启复现。**全新部署(空表)不触发。**
- **修复:** 把 `cleanup-room-overlaps.ts` esbuild 打包进镜像、entrypoint 在 migrate 前 `--fix` 调用(仿 0016 的 `pg_constraint` 快路径幂等)。或写入部署 runbook 作为强制前置。

---

## 次级确认缺陷

### F7 — `SectionDangerZone` 批量取消缺 try/catch,鉴权 throw 崩掉整个「设置」面板 【HIGH · 确认】
- **文件:** `src/app/dashboard/teach/[sectionId]/section-danger-zone.tsx:26-32`
- **裁定:** 双镜头均 **CONFIRMED HIGH**。
- **机理:** `startTransition` 内 `await cancelSeriesAction(sectionId)` 无 try/catch;该 action 是 throw 式(`requirePermission` / 所有权失败 / 会话过期均 throw,非 `{ok,error}`)。React 19.3/Next 16.3 下未捕获 rejection 冒泡到 `error.tsx`,替换整个 tab 面板 → 同面板的 CourseForm/SectionForm 未保存编辑丢失。团队已在所有兄弟调用点(ExportPanel B30、SectionSharePanel、FeedPanel B7、ReportPanel commit 5bbcd03 标 orch-review HIGH)修过,唯独这里漏了。
- **修复:** 包 try/catch 落 `show(e.message)`;或把 `cancelSeriesAction` 迁为 `{ok,error}` 返回(仿 B29)。

### F2 — `upsertAttendance` / `upsertStudentNote` 写入不校验学生在册 【HIGH→MEDIUM · 确认】
- **文件:** `src/app/dashboard/schedule/attendance-actions.ts:66-98, 151-180`
- **裁定:** 复现 → CONFIRMED HIGH;反驳 → **DOWNGRADE MEDIUM**(两镜头都确认缺陷存活,分歧在爆炸半径)。
- **机理:** 仅 `actorOwnsLesson`(查是否教这节课),不校验 `data.studentId` 是否在该 section 在册 —— 与已修的 `grade-actions.ts` B31 同类,漏改这两个兄弟函数。可给任意同租户学生写幽灵考勤/点评记录。
- **降级理由(MEDIUM):** 仅认证内部人、同租户、只写不读、幽灵行近乎不可见(per-student note 默认 `internal` 不进门户/LLM;幽灵考勤被 `getLessonRoster` 在册过滤隐藏)—— 但仍是永久记录污染,建议为 B31 对齐而修。
- **修复:** 两函数补 `grade-actions.ts` 那套 active-enrollment 校验(或抽 `assertStudentInLessonSection` 共享助手)。

### F5 — 快速评分 upsert 无唯一约束 + select-then-write 竞态,静默重复评分行污染家长报告均分 【HIGH→MEDIUM · 确认】
- **文件:** `src/app/dashboard/teach/[sectionId]/data.ts:273-312`
- **裁定:** 复现 → CONFIRMED HIGH;反驳 → **DOWNGRADE MEDIUM**。
- **机理:** `grade` 表无 `(tenant,lesson,student,title)` 唯一索引(代码注释自认),select-then-write 无事务无锁,并发两写都见空都 INSERT → 重复行。`report-data.ts` 取全量不去重、`report-stats.ts` 无权重平均 → 均分被算两次,冻结进 `statsSnapshot` 渲染入家长 PDF。对比 `attendance` 有 `uq_attendance_lesson_student` 兜底(最坏 23505 而非静默重复)。
- **降级理由(MEDIUM):** reviewer 首列的「单标签页 per-cell + 一键保存双触发」实际不可能(共享 `useTransition` + `disabled={pending}`);真实向量收窄为多标签页/设备或传输层重放,且仅当两次分数不同才可见偏差。
- **修复:** 加 partial unique index + `INSERT ... ON CONFLICT DO UPDATE`(仿 attendance)。

---

## 建议项(MEDIUM,不阻断,建议排期)

| ID | 摘要 | 文件 |
|----|------|------|
| F8 | LLM prompt 围栏 `<STUDENT_DATA>` 分隔符未对教师笔记内文本转义,理论上可围栏碰撞注入(单发、无工具、需人工审批,爆炸半径有限) | `src/lib/report-prompt.ts:89-108` |
| F9 | 提醒 cron 即使每租户扫描全失败也恒返回 200 `{ok:true}`,只看 HTTP 状态的监控看不到系统性故障 | `src/app/api/cron/reminders/route.ts:31-48` |
| F10 | 3 个 client 数据加载 `.then()` 无 `.catch()`,Server Action 因会话过期 reject 时 UI 永久转圈 | `src/app/dashboard/schedule/lesson-detail.tsx:93-111` 等 |
| F11 | 最贵的付费 LLM 报告起草路径是唯一未接限流的重动作,可被脚本刷爆账单 | `src/app/dashboard/reports/actions.ts:47-79` |
| F12 | compose 未转发 `CHROMIUM_NO_SANDBOX`,ADR 0002 记载的沙箱逃生阀在 `docker compose up` 路径下不可达(Coolify 直注入不受影响) | `docker-compose.yml:39-72` |

## 建议项(LOW)

| ID | 摘要 | 文件 |
|----|------|------|
| F3 | ~~Zip-Slip~~ **假阳性(已击杀)**:`archiver.sanitizePath` 剥离前导 `../`。仅建议修正 `safe()` 注释 + 加防御性 `..` 规范化 + 单测 | `src/app/api/export/section/[sectionId]/route.ts` |
| F13 | `gradeAverage` 跨不同满分原始分求平均,产出无意义「平均分」(9/10 与 90/100 → 49.5) | `src/lib/report-stats.ts:55-59` |
| F14 | 出勤率分子排除 `late`,全勤但每次迟到的学生显示 0% 出勤 | `src/lib/report-stats.ts:44` |
| F15 | `sectionMeeting.byDay` 读取处无运行时校验直接 `as Weekday`,自由文本列;绕过 zod 的写路径会致物化时 rrule 抛未捕获异常 | `src/lib/materialize.ts:67` |
| F16 | `rate-limit.ts` 注释声称有周期性清扫实则没有,`hits` Map 只增不删(增长受用户数×4 桶限,慢且小) | `src/lib/rate-limit.ts:18-19` |
| F17 | compose 把 app 端口绑到 `0.0.0.0:3000`(Postgres 已绑 loopback),公网 host 上 `docker compose up` 会绕过 Traefik TLS 直接明文暴露 | `docker-compose.yml:73-74` |

---

## 验证质量说明

- 14 次验证调用中 2 次因 StructuredOutput 重试上限失败,分别是 **F1 的反驳镜头**与 **F6 的复现镜头**。两者的另一镜头均产出完整 CONFIRMED 裁定,故无发现失去验证覆盖。
- 各维 reviewer 明确未 re-flag 已修项(0016 孤儿租户、H7 事务线程化、B39 last-owner、SEC5 配额锁、CR3 容量 FOR UPDATE、B31 成绩鉴权),证明「聚焦当前存活缺陷」的约束生效。

## 推荐处置顺序

1. **F6**(常规操作永久数据丢失)—— 最高优先,正常使用即触发。
2. **F1**(PII 越权)—— PIPEDA 合规敏感,上线前修。
3. **F4**(存量库崩溃循环)—— 依赖备份恢复/升级前必修;全新部署可稍后。
4. **F7 / F2 / F5** —— 一批修完(F2/F5 与已有 B31/attendance 模式对齐,机械性强)。
5. **F8–F12** 排期;**F3(改注释)/ F13–F17** 顺手。
