import 'server-only'
import { count, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { contactMessage, subscriber, popup, emailCampaign } from '@/db/schema'
import { BusinessError } from '@/lib/errors'
import type { AuthContext } from '@/auth/context'
import { assertSiteAdmin } from './authz'
import { buildPagination, type PageQuery, type Pagination } from './pagination'
import { createPopupSchema, updatePopupSchema } from './schemas'

// 官网控制台的读 + 简单 CRUD(询盘 / 订阅者 / 弹窗 / 概览统计)。邮件群发的复杂状态机单独放在
// campaigns-core.ts。
//
// ⚠️ 这里用裸 `db` 而不是 forTenant():这五张表没有 tenant_id 列，forTenant 的 TenantTable
// 约束根本套不上。隔离由 assertSiteAdmin(ctx)(超管)承担，不是租户作用域。本文件已登记进
// scripts/check-tenant-db-access.ts 的 ALLOWLIST —— 那个守卫按"裸 db CRUD"拦人、不看表。
//
// 每个导出函数**第一行**就是 assertSiteAdmin(ctx)。没有例外:少一行就是一个越权入口。
// ctx 由调用方(Server Action / 页面)在入口解析一次后传入 —— 与 listPortalUsers(ctx) 等既有
// core 的约定一致，也让这些函数可脱离 next/headers 做 DB 测试。

export type ContactRow = typeof contactMessage.$inferSelect
export type SubscriberRow = typeof subscriber.$inferSelect
export type PopupRow = typeof popup.$inferSelect

// ── 询盘收件箱(只读 + CSV 导出)─────────────────────────────────────────────────────────────
export async function listContactsCore(
  ctx: AuthContext,
  q: PageQuery,
): Promise<{ contacts: ContactRow[]; pagination: Pagination }> {
  assertSiteAdmin(ctx)
  // 列表和总数互不依赖 —— 一个 Promise.all 并发发出，而不是两次串行往返。
  const [contacts, [total]] = await Promise.all([
    db
      .select()
      .from(contactMessage)
      .orderBy(desc(contactMessage.createdAt))
      .limit(q.limit)
      .offset(q.offset),
    db.select({ value: count() }).from(contactMessage),
  ])
  return { contacts, pagination: buildPagination(total?.value ?? 0, q.page, q.limit) }
}

// ── 订阅者(列表 + 删除)────────────────────────────────────────────────────────────────────
export async function listSubscribersCore(
  ctx: AuthContext,
  q: PageQuery,
): Promise<{ subscribers: SubscriberRow[]; pagination: Pagination }> {
  assertSiteAdmin(ctx)
  const [subscribers, [total]] = await Promise.all([
    db
      .select()
      .from(subscriber)
      .orderBy(desc(subscriber.subscribedAt))
      .limit(q.limit)
      .offset(q.offset),
    db.select({ value: count() }).from(subscriber),
  ])
  return { subscribers, pagination: buildPagination(total?.value ?? 0, q.page, q.limit) }
}

export async function deleteSubscriberCore(ctx: AuthContext, id: string): Promise<void> {
  assertSiteAdmin(ctx)
  // DELETE ... RETURNING 一条语句完成"存在性检查 + 删除"。官网版是先 findUnique 再 delete,
  // 那中间有一个 TOCTOU 窗口(并发双删时第二个请求会撞上 Prisma 的 P2025 而非干净的 404)。
  // 返回空数组即"这行本来就不在"，语义与官网的 404 一致。
  const deleted = await db.delete(subscriber).where(eq(subscriber.id, id)).returning()
  if (deleted.length === 0) throw new BusinessError('订阅者不存在')
}

// 当前订阅中的人数。群发按钮的二次确认要报出"将发给多少人"——群发是不可撤销的对外动作,
// 确认框里只写"确定发送吗"等于没有确认。
export async function countActiveSubscribersCore(ctx: AuthContext): Promise<number> {
  assertSiteAdmin(ctx)
  const [row] = await db
    .select({ value: count() })
    .from(subscriber)
    .where(eq(subscriber.status, 'active'))
  return row?.value ?? 0
}

// ── 弹窗(全量列表 + 增删改)────────────────────────────────────────────────────────────────
export async function listPopupsCore(ctx: AuthContext): Promise<PopupRow[]> {
  assertSiteAdmin(ctx)
  return db.select().from(popup).orderBy(desc(popup.createdAt))
}

// 表单传来的 datetime-local 字符串 → Date | null。空串/缺省都视作"清空"。
function toDate(v: string | null | undefined): Date | null {
  return v ? new Date(v) : null
}

export async function createPopupCore(ctx: AuthContext, input: unknown): Promise<PopupRow> {
  assertSiteAdmin(ctx)
  // safeParse + BusinessError:直接 .parse() 会把整个 ZodError 抛出去，而 Server Action 若
  // 转发 e.message 就会泄漏内部结构(CWE-209)。只把第一条人类可读的提示交出去。
  const parsed = createPopupSchema.safeParse(input)
  if (!parsed.success) throw new BusinessError(parsed.error.issues[0]?.message ?? '输入不合法')
  const d = parsed.data
  const [row] = await db
    .insert(popup)
    .values({
      title: d.title,
      content: d.content,
      buttonText: d.buttonText ?? null,
      // 空串在 DB 里应当是 NULL 而不是 ''——否则官网会渲染一个 href="" 的按钮。
      buttonLink: d.buttonLink || null,
      isActive: d.isActive,
      startDate: toDate(d.startDate),
      endDate: toDate(d.endDate),
      displayRules: d.displayRules ?? null,
    })
    .returning()
  return row
}

export async function updatePopupCore(ctx: AuthContext, input: unknown): Promise<PopupRow> {
  assertSiteAdmin(ctx)
  const parsed = updatePopupSchema.safeParse(input)
  if (!parsed.success) throw new BusinessError(parsed.error.issues[0]?.message ?? '输入不合法')
  const { id, ...f } = parsed.data

  // 部分更新:只写**显式传来**的字段。这与官网版逐字一致 —— 关键在于区分 undefined(没传,
  // 不要动)和 null/''(传了空值，要清空)。一把梭地展开整个对象会把没传的字段写成 null。
  const patch: Record<string, unknown> = {}
  if (f.title !== undefined) patch.title = f.title
  if (f.content !== undefined) patch.content = f.content
  if (f.buttonText !== undefined) patch.buttonText = f.buttonText || null
  if (f.buttonLink !== undefined) patch.buttonLink = f.buttonLink || null
  if (f.isActive !== undefined) patch.isActive = f.isActive
  if (f.startDate !== undefined) patch.startDate = toDate(f.startDate)
  if (f.endDate !== undefined) patch.endDate = toDate(f.endDate)
  if (f.displayRules !== undefined) patch.displayRules = f.displayRules ?? null

  // 没有任何字段要改时直接短路 —— 空 SET 的 UPDATE 在 Drizzle 里会生成非法 SQL。
  if (Object.keys(patch).length === 0) {
    const [row] = await db.select().from(popup).where(eq(popup.id, id)).limit(1)
    if (!row) throw new BusinessError('弹窗不存在')
    return row
  }

  const [row] = await db.update(popup).set(patch).where(eq(popup.id, id)).returning()
  if (!row) throw new BusinessError('弹窗不存在')
  return row
}

export async function deletePopupCore(ctx: AuthContext, id: string): Promise<void> {
  assertSiteAdmin(ctx)
  const deleted = await db.delete(popup).where(eq(popup.id, id)).returning()
  if (deleted.length === 0) throw new BusinessError('弹窗不存在')
}

// ── 概览统计 ────────────────────────────────────────────────────────────────────────────────
export interface SiteStats {
  totalSubscribers: number
  totalContacts: number
  campaignsSent: number
  activePopups: number
}

// 官网版在浏览器里并发拉四个列表接口、再在前端 filter 出数量 —— 那会把整张 campaign 表和
// 整张 popup 表传到客户端只为了数两个数。这里改成四条 COUNT(*) 并发跑在服务端:
// 语义相同(campaignsSent = status='sent' 的数量;activePopups = is_active 的数量),
// 但不再把数据搬到前端，也没有客户端 fetch 瀑布。
export async function getSiteStatsCore(ctx: AuthContext): Promise<SiteStats> {
  assertSiteAdmin(ctx)
  const [[subs], [contacts], [sent], [active]] = await Promise.all([
    db.select({ value: count() }).from(subscriber),
    db.select({ value: count() }).from(contactMessage),
    db.select({ value: count() }).from(emailCampaign).where(eq(emailCampaign.status, 'sent')),
    db.select({ value: count() }).from(popup).where(eq(popup.isActive, true)),
  ])
  return {
    totalSubscribers: subs?.value ?? 0,
    totalContacts: contacts?.value ?? 0,
    campaignsSent: sent?.value ?? 0,
    activePopups: active?.value ?? 0,
  }
}

// CSV 导出用的全量读取(不分页)。官网的导出按钮只导出**当前页**，那是个实现缺陷而不是需求
// —— 导出的用途是拿全量去做外部处理。这里给一个显式上限兜住内存:超过上限时宁可报错，
// 也不要悄悄截断让运营方以为自己拿到了全部数据。
const EXPORT_MAX_ROWS = 10_000

export async function exportContactsCore(ctx: AuthContext): Promise<ContactRow[]> {
  assertSiteAdmin(ctx)
  const rows = await db
    .select()
    .from(contactMessage)
    .orderBy(desc(contactMessage.createdAt))
    .limit(EXPORT_MAX_ROWS + 1)
  if (rows.length > EXPORT_MAX_ROWS) {
    throw new BusinessError(`询盘超过 ${EXPORT_MAX_ROWS} 条，无法一次性导出，请联系开发分批处理`)
  }
  return rows
}

export async function exportSubscribersCore(ctx: AuthContext): Promise<SubscriberRow[]> {
  assertSiteAdmin(ctx)
  const rows = await db
    .select()
    .from(subscriber)
    .orderBy(desc(subscriber.subscribedAt))
    .limit(EXPORT_MAX_ROWS + 1)
  if (rows.length > EXPORT_MAX_ROWS) {
    throw new BusinessError(`订阅者超过 ${EXPORT_MAX_ROWS} 条，无法一次性导出，请联系开发分批处理`)
  }
  return rows
}
