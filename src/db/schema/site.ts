import {
  pgTable,
  text,
  boolean,
  integer,
  timestamp,
  index,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/pg-core'
import { primaryId, createdAt, updatedAt } from './_helpers'

// ── 官网（ithacateens.com）运营数据 ────────────────────────────────────────────────────────────
//
// 这五张表从官网仓(ItahcaFA-web, SvelteKit + Prisma)的 /admin 移植过来，是 PLATFORM-GLOBAL 的:
// 只有一个官网，所以它们**没有 tenant_id 列**，forTenant() 不适用，也不该适用——给市场站的询盘
// 按机构分片是没有意义的。访问控制改由两道门把守，而不是租户作用域:
//
//   1. /dashboard/site 控制台 —— ctx.isPlatformAdmin(超级管理员)，布局和每个 Server Action 都查;
//   2. /api/site/* 写入端点  —— SITE_INGEST_SECRET Bearer 恒定时间比对(官网服务端调用)。
//
// 因此触碰这些表的模块必须登记进 scripts/check-tenant-db-access.ts 的 ALLOWLIST ——
// 那个守卫按"裸 db CRUD"拦人，不看表，所以非租户表也会被它拦下。
//
// 列名刻意与官网 Prisma schema 的 @map 名逐字一致(snake_case)，这样两边的 SQL 可以互读、
// 运维可以拿同一份 pg_dump 对照。id 改用本项目的 nanoid primaryId()(Prisma 用 cuid)——
// 不迁移历史数据，新库从零开始，所以 id 生成器不必兼容。

export const subscriber = pgTable(
  'subscribers',
  {
    id: primaryId(),
    email: text('email').notNull(),
    name: text('name'),
    // 'active' | 'unsubscribed'。沿用官网的字符串列(不升级成 pg enum):官网 Prisma 侧是
    // String，而群发用 status='active' 过滤收件人，枚举化会让两边的迁移失去对称性。
    status: text('status').notNull().default('active'),
    subscribedAt: timestamp('subscribed_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // 全局唯一。订阅 upsert 和群发去重都靠它:/api/site/subscribe 的并发竞态由这个约束
    // 收口(单赢家插入)，而不是靠先读后写。
    uniqueIndex('uq_subscribers_email').on(t.email),
    // 群发收件人查询是 where status='active'——全表扫在订阅者上万后才痛，但这个索引很便宜。
    index('idx_subscribers_status').on(t.status),
  ],
)

export const contactMessage = pgTable(
  'contact_messages',
  {
    id: primaryId(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    message: text('message'),
    subscribe: boolean('subscribe').notNull().default(false),
    createdAt: createdAt(),

    // ── 改版 PRD 加的资格字段。全部可空/有默认值 ───────────────────────────────────────────
    // 官网会写入它们，但官网现有的 /admin 询盘页并不展示——这里按严格对等移植，列先建好，
    // 展示留作后续(见 PR 描述)。不建列反而会让官网的写入丢字段。
    locale: text('locale'), // 'en' | 'zh'，决定确认信语言
    grade: integer('grade'), // 4–12
    // Prisma 的 String[] → Postgres text[]。默认空数组而非 null，调用方不必区分
    // "什么都没选"和"这个字段当时还不存在"。
    programs: text('programs').array().notNull().default([]),
    topic: text('topic'), // 'program' | 'join' | 'general'
    source: text('source'), // 自由文本:微信渠道在分析工具里是隐形的
    status: text('status').notNull().default('new'), // 'new' | 'contacted' | 'closed'
    notes: text('notes'), // 内部分诊备注
  },
  (t) => [
    index('idx_contact_messages_created_at').on(t.createdAt), // 列表按 createdAt 倒序
    index('idx_contact_messages_status').on(t.status),
  ],
)

export const emailCampaign = pgTable(
  'email_campaigns',
  {
    id: primaryId(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    // 'draft' | 'sending' | 'sent' | 'failed'。这个列是群发并发控制的核心:
    // sendCampaignCore 用一条带 WHERE 的 UPDATE 原子抢占 'sending'，见 site/campaigns-core.ts。
    status: text('status').notNull().default('draft'),
    recipientCount: integer('recipient_count').notNull().default(0),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    // $onUpdate 让 updatedAt 在抢占那条 UPDATE 上自动前移 —— 陈旧回收窗口(STALE_SENDING_MS)
    // 就是拿它当"本次发送开始时间"来判定的，所以这个自动更新是**语义依赖**，不是装饰。
    updatedAt: updatedAt(),
  },
  (t) => [index('idx_email_campaigns_created_at').on(t.createdAt)],
)

// 重试幂等台账:每个成功送达的 (campaign, recipient) 一行。发送前拿它过滤已送达的收件人，
// 所以"中途失败 + 重试"只会补发未入账的那部分，永不重复轰炸。
export const emailDelivery = pgTable(
  'email_deliveries',
  {
    id: primaryId(),
    campaignId: text('campaign_id').notNull(),
    email: text('email').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.campaignId],
      foreignColumns: [emailCampaign.id],
      name: 'fk_email_deliveries_campaign',
    }).onDelete('cascade'),
    // 幂等的基石:批量入账走 onConflictDoNothing 打在这个约束上，所以并发/重试都不会写重。
    uniqueIndex('uq_email_deliveries_campaign_email').on(t.campaignId, t.email),
    // 覆盖上面的 FK，也服务 where campaign_id = ? 的台账读取。
    index('idx_email_deliveries_campaign').on(t.campaignId),
  ],
)

export const popup = pgTable(
  'popups',
  {
    id: primaryId(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    buttonText: text('button_text'),
    // 这一列会被渲染进官网每个访客浏览器里的 <a href>，所以写入侧的 zod schema 只放行
    // http(s)(见 src/lib/site/popup-schema.ts)——裸 z.string().url() 会放过 javascript:
    // 和 data:，那是存储型 XSS。约束放在应用层而非 CHECK:URL 合法性不是 SQL 擅长表达的。
    buttonLink: text('button_link'),
    isActive: boolean('is_active').notNull().default(false),
    startDate: timestamp('start_date', { withTimezone: true, mode: 'date' }),
    endDate: timestamp('end_date', { withTimezone: true, mode: 'date' }),
    displayRules: text('display_rules'), // JSON 文本: { pages: [], frequency: 'once'|'session'|'always' }
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // 生效弹窗查询是 where is_active and (时间窗) order by created_at desc limit 1。
    index('idx_popups_active_created_at').on(t.isActive, t.createdAt),
  ],
)
