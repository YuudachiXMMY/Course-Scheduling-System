import 'server-only'
import { and, desc, eq, lt, notInArray, or } from 'drizzle-orm'
import { db } from '@/db'
import { emailCampaign, emailDelivery, subscriber } from '@/db/schema'
import { BusinessError } from '@/lib/errors'
import { isMailConfigured, sendMailBatchSettled } from '@/lib/mail'
import type { AuthContext } from '@/auth/context'
import { assertSiteAdmin } from './authz'
import { partitionRecipients } from './recipients'
import { createCampaignSchema } from './schemas'

// 邮件群发。从官网仓 src/routes/api/admin/emails/{+server.ts,send/+server.ts} 移植。
//
// ⚠️ 裸 `db`:平台全局表，无 tenant_id,forTenant 不适用。已登记进 ALLOWLIST。
//
// 这个文件里的每一道防线都对应一个"会真的把信重复发给全体订阅者"的故障，移植时**逐条保留**:
//   1. SMTP 未配置 → 503 硬失败，且在抢占之前。否则每封信 no-op、每个收件人入账、campaign
//      标记 sent → 这封信永久无法重发。
//   2. 原子抢占 → 只有一个并发请求能把状态迁入 'sending'。否则两个并行请求都过了状态检查，
//      全体订阅者收到两封。
//   3. 陈旧回收 → 崩溃留下的 'sending' 在 STALE_SENDING_MS 后可重新抢占。投递台账让重跑安全。
//   4. 逐封入账 → 只有真正送达的收件人入账，所以重试只补发未送达的那部分。
//   5. 每个批次都尝试(allSettled，不提前 abort)→ 尾部批次不会因为中间批次失败而被跳过。

export type CampaignRow = typeof emailCampaign.$inferSelect

const BATCH_SIZE = 50

// 回收被崩溃或写状态失败卡在 'sending' 的 campaign。下面的抢占会把 updatedAt($onUpdate)推到
// 发送开始时刻，所以一条过了这个窗口还停在 'sending' 的行就视为已废弃、可回收。这个窗口必须
// **大于**最长的真实发送耗时，否则一个慢但活着的发送会被二次抢占;投递台账让回收本身是安全的
// (只会重发未入账的收件人)。
const STALE_SENDING_MS = 30 * 60 * 1000

export async function listCampaignsCore(ctx: AuthContext): Promise<CampaignRow[]> {
  assertSiteAdmin(ctx)
  return db.select().from(emailCampaign).orderBy(desc(emailCampaign.createdAt))
}

export async function createCampaignCore(ctx: AuthContext, input: unknown): Promise<CampaignRow> {
  assertSiteAdmin(ctx)
  const parsed = createCampaignSchema.safeParse(input)
  if (!parsed.success) throw new BusinessError(parsed.error.issues[0]?.message ?? '输入不合法')
  const [row] = await db
    .insert(emailCampaign)
    .values({ subject: parsed.data.subject, body: parsed.data.body })
    .returning()
  return row
}

export async function deleteCampaignCore(ctx: AuthContext, id: string): Promise<void> {
  assertSiteAdmin(ctx)
  // 正在发送的 campaign 不许删 —— 删掉会级联带走投递台账(FK onDelete cascade)，
  // 而台账正是"哪些人已经收到"的唯一记录。已发送的允许删(归档语义)。
  const deleted = await db
    .delete(emailCampaign)
    .where(and(eq(emailCampaign.id, id), notInArray(emailCampaign.status, ['sending'])))
    .returning()
  if (deleted.length === 0) {
    // 区分"不存在"和"正在发送"需要一次额外查询。值得:两者的处置完全不同。
    const [existing] = await db
      .select({ status: emailCampaign.status })
      .from(emailCampaign)
      .where(eq(emailCampaign.id, id))
      .limit(1)
    throw new BusinessError(existing ? '该邮件正在发送中，无法删除' : '邮件不存在')
  }
}

export interface SendResult {
  recipientCount: number
}

export async function sendCampaignCore(ctx: AuthContext, id: string): Promise<SendResult> {
  assertSiteAdmin(ctx)

  const [campaign] = await db.select().from(emailCampaign).where(eq(emailCampaign.id, id)).limit(1)
  if (!campaign) throw new BusinessError('邮件不存在')

  // 防线 1 —— 必须在抢占**之前**:误配置的服务器于是一行都不会写。
  if (!isMailConfigured) {
    throw new BusinessError('服务器未配置邮件发送(SMTP)，无法群发')
  }

  // 防线 2+3 —— 原子抢占。一条 UPDATE 在拿到行锁后会重新求值 WHERE，所以两个并发调用必然
  // 串行化:输家的谓词已不成立，拿到 0 行。OR 的第二支顺带回收卡在 'sending' 超过
  // STALE_SENDING_MS 的行(那是跳过了 catch 的硬崩溃)。
  const staleBefore = new Date(Date.now() - STALE_SENDING_MS)
  const claimed = await db
    .update(emailCampaign)
    // updatedAt 显式写入，不依赖 $onUpdate:它就是陈旧回收窗口的"本次发送开始时间",
    // 属于语义依赖。哪天有人把 schema 里的 $onUpdate 去掉，回收窗口不该跟着静默失效。
    .set({ status: 'sending', updatedAt: new Date() })
    .where(
      and(
        eq(emailCampaign.id, id),
        or(
          notInArray(emailCampaign.status, ['sending', 'sent']),
          and(eq(emailCampaign.status, 'sending'), lt(emailCampaign.updatedAt, staleBefore)),
        ),
      ),
    )
    .returning({ id: emailCampaign.id })
  if (claimed.length !== 1) {
    throw new BusinessError('该邮件已发送或正在发送中')
  }

  // 抢占之后的一切都在 try/catch 里 —— **任何**失败(包括订阅者查询本身)都要把状态翻回
  // 'failed',那是立即可重新抢占的状态。跳过 catch 的硬崩溃会把行搁在 'sending',
  // 由上面的陈旧窗口在 STALE_SENDING_MS 后回收。
  try {
    // 活跃订阅者与投递台账两次读取互不依赖 —— 一个 Promise.all，而不是两次串行往返。
    const [subscribers, delivered] = await Promise.all([
      db
        .select({ email: subscriber.email })
        .from(subscriber)
        .where(eq(subscriber.status, 'active')),
      db
        .select({ email: emailDelivery.email })
        .from(emailDelivery)
        .where(eq(emailDelivery.campaignId, id)),
    ])
    if (subscribers.length === 0) {
      await db.update(emailCampaign).set({ status: 'failed' }).where(eq(emailCampaign.id, id))
      throw new BusinessError('没有活跃订阅者可发送')
    }

    // 防线 4 —— 拿活跃订阅者与台账做差集，于是"部分失败后重试"只发未送达的余量。
    const { pending, alreadyCount } = partitionRecipients(
      subscribers.map((s) => s.email),
      delivered.map((d) => d.email),
    )

    // 统计**实际送达**的人数(已入账 + 本次送达)，而不是台账∪待发的并集，这样
    // recipientCount 真的等于"多少人收到了这封信"。用 alreadyCount 作种子，使"已全部送达后
    // 再重试"(循环不执行)仍报告真实总数。
    let deliveredCount = alreadyCount
    let failedCount = 0
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE).map((email) => ({
        to: email,
        subject: campaign.subject,
        html: campaign.body,
      }))
      // 防线 5 —— allSettled:每个批次都会被尝试，中间批次失败不会跳过尾部。
      const { delivered: sent, failed } = await sendMailBatchSettled(batch)
      if (sent.length > 0) {
        await db
          .insert(emailDelivery)
          .values(sent.map((email) => ({ campaignId: id, email })))
          // 打在 uq_email_deliveries_campaign_email 上:并发/重试都不会写重。
          .onConflictDoNothing({ target: [emailDelivery.campaignId, emailDelivery.email] })
        deliveredCount += sent.length
      }
      if (failed.length > 0) {
        failedCount += failed.length
        // 只打前 5 条:失败名单可能是整批 50 个地址，没必要灌满日志。
        console.error(
          `[site/campaign] 本批 ${failed.length}/${batch.length} 个收件人失败`,
          failed.slice(0, 5),
        )
      }
    }

    if (failedCount > 0) {
      // 已送达的都已入账，所以标记 failed 后重试只会补发余量。
      await db.update(emailCampaign).set({ status: 'failed' }).where(eq(emailCampaign.id, id))
      throw new BusinessError(`${failedCount} 个收件人发送失败，点击重试可只补发未送达的部分`)
    }

    // 正常发送与"已全部送达的重试"共用这一处收尾(pending 为空时循环不执行,
    // deliveredCount 保持 alreadyCount)。
    await db
      .update(emailCampaign)
      .set({ status: 'sent', recipientCount: deliveredCount, sentAt: new Date() })
      .where(eq(emailCampaign.id, id))
    return { recipientCount: deliveredCount }
  } catch (error) {
    // BusinessError 是我们自己抛的、已经把状态置好的受控分支 —— 原样上抛，不要再翻一次状态。
    if (error instanceof BusinessError) throw error
    console.error('[site/campaign] 群发失败', error)
    await db.update(emailCampaign).set({ status: 'failed' }).where(eq(emailCampaign.id, id))
    throw new BusinessError('发送失败，请稍后重试')
  }
}

// 测试/脚本复用这两个常量，免得各处重写魔数。
export { BATCH_SIZE, STALE_SENDING_MS }
