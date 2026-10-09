import 'server-only'
import { and, desc, eq, isNull, lte, gte, or } from 'drizzle-orm'
import { db } from '@/db'
import { contactMessage, subscriber, popup } from '@/db/schema'
import { isUniqueViolation } from '@/lib/errors'
import { siteContactSchema, siteSubscribeSchema, type SubscribeOutcome } from './schemas'

type PopupRow = typeof popup.$inferSelect

// 写入端点的校验失败 —— 与 BusinessError 区分开:这不是给终端用户看的业务提示，而是给
// 官网开发者看的集成错误。单独一个类型，路由层才能把它映射成 400 而不是 500。
export class IngestValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IngestValidationError'
  }
}

// 官网(ithacateens.com)服务端调用的写入/读取路径。
//
// ⚠️ 这里**没有 AuthContext**——调用方是另一个服务，不是一个登录用户。
// 主体验证由路由层的 SITE_INGEST_SECRET 恒定时间比对完成(src/app/api/site/_auth.ts),
// 本模块只负责数据正确性。两件事必须分清:
//   · 密钥证明"是官网在调"，不证明"官网没出 bug"→ 所以每个函数都自己再跑一遍 zod。
//   · 这些函数绝不接受任何形式的"以某用户身份"参数 —— 没有身份可冒充，也就无从越权。
//
// ⚠️ 裸 `db`:平台全局表，无 tenant_id,forTenant 不适用。已登记进 ALLOWLIST。

export async function recordContactCore(input: unknown): Promise<void> {
  const parsed = siteContactSchema.safeParse(input)
  if (!parsed.success) {
    // 这是服务间调用:把 zod 的首条消息交给官网日志用，它不会被转发给访客。
    throw new IngestValidationError(parsed.error.issues[0]?.message ?? 'invalid input')
  }
  const d = parsed.data

  // 询盘行与(可选的)订阅记录必须一起成功:只写了询盘而漏掉订阅，等于访客勾了"订阅"却没订上,
  // 而且没有任何痕迹能让人发现。放在一个事务里。
  await db.transaction(async (tx) => {
    await tx.insert(contactMessage).values({
      name: d.name,
      email: d.email,
      phone: d.phone ?? null,
      message: d.message ?? null,
      subscribe: d.subscribe,
      locale: d.locale ?? null,
      grade: d.grade ?? null,
      programs: d.programs,
      topic: d.topic ?? null,
      source: d.source ?? null,
    })

    if (d.subscribe) {
      // 原子 upsert 关掉了"先查后写"的 TOCTOU(唯一键是 email)。update 分支在已是 active 时
      // 是个无害的 no-op —— 但仍要写 name:访客这次留了姓名、上次没留，应该补上。
      await tx
        .insert(subscriber)
        .values({ email: d.email, name: d.name, status: 'active' })
        .onConflictDoUpdate({
          target: subscriber.email,
          set: { status: 'active', name: d.name, updatedAt: new Date() },
        })
    }
  })
}

/**
 * 订阅。返回三态结果，让官网还原它原本的行为:
 *   created        → 官网发欢迎信(只有真正插入的那一方发，所以并发不会重复发)
 *   reactivated    → 不发信(此人之前退订过，这次只是恢复)
 *   already_active → 官网回 409「该邮箱已订阅」
 *
 * 为什么是"先插入、撞唯一键再处理"而不是"先查再插":前者让插入成为单一赢家,
 * 并发下只有一个请求会拿到 created,也就只会发出一封欢迎信。反过来写则两个并发请求
 * 都会查到"不存在"，然后一个插入成功、一个报错 —— 或者更糟，两封欢迎信。
 */
export async function recordSubscribeCore(input: unknown): Promise<SubscribeOutcome> {
  const parsed = siteSubscribeSchema.safeParse(input)
  if (!parsed.success) {
    throw new IngestValidationError(parsed.error.issues[0]?.message ?? 'invalid input')
  }
  const { email, name } = parsed.data

  try {
    await db.insert(subscriber).values({ email, name: name ?? null, status: 'active' })
    return 'created'
  } catch (e) {
    // 23505 = 唯一键冲突(uq_subscribers_email)。isUniqueViolation 会沿 .cause 链找,
    // 因为 Drizzle 0.45 把 postgres.js 的错误包在 DrizzleQueryError 里。
    if (!isUniqueViolation(e)) throw e
  }

  // 走到这里说明这个邮箱已存在。读出当前状态决定是 409 还是恢复订阅。
  const [existing] = await db
    .select({ status: subscriber.status, name: subscriber.name })
    .from(subscriber)
    .where(eq(subscriber.email, email))
    .limit(1)

  // 极罕见:插入撞了唯一键，但紧接着这行被删了。按"重新插入"处理而不是报错 ——
  // 对调用方来说这等价于首次订阅。
  if (!existing) {
    await db.insert(subscriber).values({ email, name: name ?? null, status: 'active' })
    return 'created'
  }

  if (existing.status === 'active') return 'already_active'

  await db
    .update(subscriber)
    // 本次没带姓名时保留原有姓名(?? existing.name)，不要把它清成 null。
    .set({ status: 'active', name: name ?? existing.name, updatedAt: new Date() })
    .where(eq(subscriber.email, email))
  return 'reactivated'
}

/**
 * 当前生效的弹窗(官网每个公开页面都会间接读到它，官网侧有 60 秒进程内缓存)。
 *
 * 时间窗语义与官网原查询逐字等价:**startDate 为空或已过，且 endDate 为空或未到**,
 * 闭区间(lte / gte)。纯判定版本见 popup-active.ts(单测钉住四种组合);这里写成 SQL
 * 是为了让"取最新一条"由数据库完成，而不是把全表拉回来再过滤。
 */
export async function getActivePopupCore(now: Date = new Date()): Promise<PopupRow | null> {
  const [row] = await db
    .select()
    .from(popup)
    .where(
      and(
        eq(popup.isActive, true),
        or(isNull(popup.startDate), lte(popup.startDate, now)),
        or(isNull(popup.endDate), gte(popup.endDate, now)),
      ),
    )
    .orderBy(desc(popup.createdAt))
    .limit(1)
  return row ?? null
}
