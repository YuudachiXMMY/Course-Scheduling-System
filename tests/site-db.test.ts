import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { eq, like, inArray } from 'drizzle-orm'

// mail 模块在被测模块导入**之前**替换掉:真实 mail.ts 会按 env 建 SMTP 连接池,而这里要
// 控制"送达/失败"的结果来驱动群发状态机。isMailConfigured 置 true 以越过第一道硬失败守卫。
const sendMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/mail', () => ({
  isMailConfigured: true,
  sendMailBatchSettled: sendMock,
  splitSettled: () => ({ delivered: [], failed: [] }),
  assertTlsConfigSafe: () => {},
  closeMailTransports: () => {},
}))

const { db } = await import('@/db')
const { subscriber, contactMessage, emailCampaign, emailDelivery, popup } = await import(
  '@/db/schema'
)
const { recordContactCore, recordSubscribeCore, getActivePopupCore, IngestValidationError } =
  await import('@/lib/site/ingest-core')
const { sendCampaignCore, createCampaignCore, listCampaignsCore, STALE_SENDING_MS } = await import(
  '@/lib/site/campaigns-core'
)
const { listSubscribersCore, deleteSubscriberCore } = await import('@/lib/site/admin-core')
const { parsePagination } = await import('@/lib/site/pagination')
type AuthContext = import('@/auth/context').AuthContext

// 官网数据是平台全局的(无 tenant_id),所以测试 ctx 只需要 isPlatformAdmin。tenantId/role 填占位值
// —— 这些 core 根本不读它们，这本身就是"这些表不在租户模型内"的一个证明。
const superAdmin: AuthContext = {
  userId: 'u_site_test',
  tenantId: 'org_irrelevant',
  role: 'owner',
  isPlatformAdmin: true,
}
const notSuperAdmin: AuthContext = { ...superAdmin, isPlatformAdmin: false }

// 所有测试数据用这个前缀，清理时按前缀删 —— 不会碰到同一个库里别的测试或开发数据。
const P = 'sitetest_'
const mail = (n: string) => `${P}${n}@example.com`

async function cleanup() {
  // email_deliveries 由 FK onDelete cascade 跟着 campaign 走，但显式删一遍更稳
  // (万一将来 FK 被改掉，测试不该变成互相污染)。
  const camps = await db
    .select({ id: emailCampaign.id })
    .from(emailCampaign)
    .where(like(emailCampaign.subject, `${P}%`))
  if (camps.length > 0) {
    await db.delete(emailDelivery).where(
      inArray(
        emailDelivery.campaignId,
        camps.map((c) => c.id),
      ),
    )
    await db.delete(emailCampaign).where(like(emailCampaign.subject, `${P}%`))
  }
  await db.delete(subscriber).where(like(subscriber.email, `${P}%`))
  await db.delete(contactMessage).where(like(contactMessage.email, `${P}%`))
  await db.delete(popup).where(like(popup.title, `${P}%`))
}

beforeEach(async () => {
  sendMock.mockReset()
  await cleanup()
})
afterAll(cleanup)

describe('assertSiteAdmin — 非超管一律拒绝', () => {
  it('普通 owner 读不到官网数据', async () => {
    // 这是整个控制台的授权边界。租户 RBAC 在这里无从表达(表没有 tenant_id),所以
    // "只有平台超管"必须由这条断言兜住 —— 它退化即全站询盘/订阅列表对任意机构管理员开放。
    await expect(listSubscribersCore(notSuperAdmin, parsePagination({}))).rejects.toThrow()
    await expect(deleteSubscriberCore(notSuperAdmin, 'whatever')).rejects.toThrow()
    await expect(listCampaignsCore(notSuperAdmin)).rejects.toThrow()
  })
})

describe('recordContactCore — 询盘写入', () => {
  it('写入询盘;subscribe=false 时不建订阅者', async () => {
    await recordContactCore({ name: '张三', email: mail('c1'), message: '你好', subscribe: false })
    const rows = await db
      .select()
      .from(contactMessage)
      .where(eq(contactMessage.email, mail('c1')))
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('张三')
    expect(rows[0].programs).toEqual([]) // 默认空数组，而不是 null
    expect(rows[0].status).toBe('new')
    const subs = await db.select().from(subscriber).where(eq(subscriber.email, mail('c1')))
    expect(subs).toHaveLength(0)
  })

  it('subscribe=true 时询盘与订阅者在同一事务里一起写入', async () => {
    await recordContactCore({ name: '李四', email: mail('c2'), subscribe: true })
    const contacts = await db
      .select()
      .from(contactMessage)
      .where(eq(contactMessage.email, mail('c2')))
    const subs = await db.select().from(subscriber).where(eq(subscriber.email, mail('c2')))
    expect(contacts).toHaveLength(1)
    expect(subs).toHaveLength(1)
    expect(subs[0].status).toBe('active')
    expect(subs[0].name).toBe('李四')
  })

  it('已退订的人再次勾选订阅 → upsert 把状态恢复为 active 并补上姓名', async () => {
    await db
      .insert(subscriber)
      .values({ email: mail('c3'), name: null, status: 'unsubscribed' })
    await recordContactCore({ name: '王五', email: mail('c3'), subscribe: true })
    const [s] = await db.select().from(subscriber).where(eq(subscriber.email, mail('c3')))
    expect(s.status).toBe('active')
    expect(s.name).toBe('王五') // 上次没留姓名，这次留了 → 补上
  })

  it('保留资格字段(locale/grade/programs/topic/source)', async () => {
    await recordContactCore({
      name: '赵六',
      email: mail('c4'),
      locale: 'zh',
      grade: 9,
      programs: ['ev-team', 'robotics'],
      topic: 'program',
      source: '微信',
    })
    const [c] = await db.select().from(contactMessage).where(eq(contactMessage.email, mail('c4')))
    expect(c.locale).toBe('zh')
    expect(c.grade).toBe(9)
    expect(c.programs).toEqual(['ev-team', 'robotics'])
    expect(c.topic).toBe('program')
    expect(c.source).toBe('微信')
  })

  it('非法输入抛 IngestValidationError(路由层据此回 400 而不是 500)', async () => {
    await expect(recordContactCore({ email: 'nope' })).rejects.toBeInstanceOf(
      IngestValidationError,
    )
    await expect(
      recordContactCore({ name: 'A', email: mail('c5'), grade: 99 }),
    ).rejects.toBeInstanceOf(IngestValidationError)
  })
})

describe('recordSubscribeCore — 订阅三态', () => {
  it('首次订阅 → created', async () => {
    expect(await recordSubscribeCore({ email: mail('s1'), name: 'A' })).toBe('created')
  })

  it('已在订阅中 → already_active（官网据此回 409，且不重复发欢迎信）', async () => {
    await recordSubscribeCore({ email: mail('s2') })
    expect(await recordSubscribeCore({ email: mail('s2') })).toBe('already_active')
  })

  it('曾退订 → reactivated（恢复订阅但不发欢迎信）', async () => {
    await db.insert(subscriber).values({ email: mail('s3'), name: '老用户', status: 'unsubscribed' })
    expect(await recordSubscribeCore({ email: mail('s3') })).toBe('reactivated')
    const [s] = await db.select().from(subscriber).where(eq(subscriber.email, mail('s3')))
    expect(s.status).toBe('active')
    // 本次没带姓名 → 保留原有姓名，不要清成 null。
    expect(s.name).toBe('老用户')
  })

  it('恢复订阅时带了新姓名则覆盖', async () => {
    await db.insert(subscriber).values({ email: mail('s4'), name: '旧名', status: 'unsubscribed' })
    expect(await recordSubscribeCore({ email: mail('s4'), name: '新名' })).toBe('reactivated')
    const [s] = await db.select().from(subscriber).where(eq(subscriber.email, mail('s4')))
    expect(s.name).toBe('新名')
  })

  it('并发订阅同一邮箱:只有一个拿到 created（唯一键收口 → 只发一封欢迎信）', async () => {
    // 这是"先插入、撞唯一键再处理"这个写法的全部意义。换成"先查再插"，两个并发请求都会
    // 查到不存在，于是可能发出两封欢迎信。
    const results = await Promise.all([
      recordSubscribeCore({ email: mail('s5') }),
      recordSubscribeCore({ email: mail('s5') }),
      recordSubscribeCore({ email: mail('s5') }),
    ])
    expect(results.filter((r) => r === 'created')).toHaveLength(1)
    expect(results.filter((r) => r === 'already_active')).toHaveLength(2)
    const rows = await db.select().from(subscriber).where(eq(subscriber.email, mail('s5')))
    expect(rows).toHaveLength(1)
  })
})

describe('getActivePopupCore — 生效弹窗', () => {
  const now = new Date('2026-06-15T12:00:00Z')
  const past = new Date('2026-06-01T00:00:00Z')
  const future = new Date('2026-07-01T00:00:00Z')

  it('未启用的不返回', async () => {
    await db.insert(popup).values({ title: `${P}off`, content: 'c', isActive: false })
    expect(await getActivePopupCore(now)).toBeNull()
  })

  it('启用且无时间窗的返回', async () => {
    await db.insert(popup).values({ title: `${P}always`, content: 'c', isActive: true })
    const p = await getActivePopupCore(now)
    expect(p?.title).toBe(`${P}always`)
  })

  it('时间窗外的不返回(未开始 / 已结束)', async () => {
    await db
      .insert(popup)
      .values({ title: `${P}later`, content: 'c', isActive: true, startDate: future })
    await db
      .insert(popup)
      .values({ title: `${P}over`, content: 'c', isActive: true, endDate: past })
    expect(await getActivePopupCore(now)).toBeNull()
  })

  it('多条同时生效时取最新创建的一条', async () => {
    await db.insert(popup).values({ title: `${P}old`, content: 'c', isActive: true })
    // createdAt 默认 now() —— 两条同一事务外插入会有微秒级差异，但为了确定性显式给值。
    await db.insert(popup).values({
      title: `${P}new`,
      content: 'c',
      isActive: true,
      createdAt: new Date(Date.now() + 1000),
    })
    const p = await getActivePopupCore(now)
    expect(p?.title).toBe(`${P}new`)
  })
})

describe('sendCampaignCore — 群发状态机', () => {
  async function seedSubscribers(n: number) {
    await db
      .insert(subscriber)
      .values(Array.from({ length: n }, (_, i) => ({ email: mail(`r${i}`), status: 'active' })))
  }

  async function newCampaign(suffix = 'x') {
    return createCampaignCore(superAdmin, { subject: `${P}${suffix}`, body: '<p>hi</p>' })
  }

  it('没有活跃订阅者时标记 failed 并报错(而不是假装发完)', async () => {
    const c = await newCampaign('nosubs')
    await expect(sendCampaignCore(superAdmin, c.id)).rejects.toThrow(/没有活跃订阅者/)
    const [after] = await db.select().from(emailCampaign).where(eq(emailCampaign.id, c.id))
    expect(after.status).toBe('failed') // failed 是可重新抢占的状态
  })

  it('全部送达 → sent，recipientCount = 实际送达人数，台账逐人入账', async () => {
    await seedSubscribers(3)
    const c = await newCampaign('ok')
    sendMock.mockImplementation(
      async (msgs: { to: string }[]) => ({ delivered: msgs.map((m) => m.to), failed: [] }),
    )

    expect(await sendCampaignCore(superAdmin, c.id)).toEqual({ recipientCount: 3 })
    const [after] = await db.select().from(emailCampaign).where(eq(emailCampaign.id, c.id))
    expect(after.status).toBe('sent')
    expect(after.recipientCount).toBe(3)
    expect(after.sentAt).not.toBeNull()
    const ledger = await db
      .select()
      .from(emailDelivery)
      .where(eq(emailDelivery.campaignId, c.id))
    expect(ledger).toHaveLength(3)
  })

  it('已发送的不能再发(原子抢占)', async () => {
    await seedSubscribers(1)
    const c = await newCampaign('once')
    sendMock.mockImplementation(async (msgs: { to: string }[]) => ({
      delivered: msgs.map((m) => m.to),
      failed: [],
    }))
    await sendCampaignCore(superAdmin, c.id)
    await expect(sendCampaignCore(superAdmin, c.id)).rejects.toThrow(/已发送或正在发送/)
  })

  it('并发两次发送:只有一个赢，另一个被抢占挡住 —— 订阅者不会收到两封', async () => {
    // 这是最重要的一条。没有原子抢占，两个并行请求都会通过状态检查，全体订阅者各收两封信。
    await seedSubscribers(2)
    const c = await newCampaign('race')
    sendMock.mockImplementation(async (msgs: { to: string }[]) => ({
      delivered: msgs.map((m) => m.to),
      failed: [],
    }))

    const results = await Promise.allSettled([
      sendCampaignCore(superAdmin, c.id),
      sendCampaignCore(superAdmin, c.id),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    // 每人只入账一次(unique(campaign_id,email) + onConflictDoNothing)。
    const ledger = await db
      .select()
      .from(emailDelivery)
      .where(eq(emailDelivery.campaignId, c.id))
    expect(ledger).toHaveLength(2)
  })

  it('部分失败 → failed;重试只补发未入账的那部分', async () => {
    await seedSubscribers(3)
    const c = await newCampaign('partial')

    // 第一次:只有 r0 送达，另外两个失败。
    sendMock.mockImplementationOnce(async (msgs: { to: string }[]) => ({
      delivered: [msgs[0].to],
      failed: msgs.slice(1).map((m) => ({ to: m.to, error: 'boom' })),
    }))
    await expect(sendCampaignCore(superAdmin, c.id)).rejects.toThrow(/收件人发送失败/)
    const [mid] = await db.select().from(emailCampaign).where(eq(emailCampaign.id, c.id))
    expect(mid.status).toBe('failed')
    const ledger1 = await db
      .select()
      .from(emailDelivery)
      .where(eq(emailDelivery.campaignId, c.id))
    expect(ledger1).toHaveLength(1) // 只有真正送达的那个入账

    // 第二次(重试):mail 层只应收到**剩下 2 个**收件人 —— 已送达的那个不得再发。
    sendMock.mockImplementationOnce(async (msgs: { to: string }[]) => {
      expect(msgs).toHaveLength(2)
      expect(msgs.map((m) => m.to)).not.toContain(ledger1[0].email)
      return { delivered: msgs.map((m) => m.to), failed: [] }
    })
    // recipientCount = 1(已入账) + 2(本次送达) = 3,即"真的收到这封信的人数"。
    expect(await sendCampaignCore(superAdmin, c.id)).toEqual({ recipientCount: 3 })
    const [done] = await db.select().from(emailCampaign).where(eq(emailCampaign.id, c.id))
    expect(done.status).toBe('sent')
    expect(done.recipientCount).toBe(3)
  })

  it('已全部送达后重试:不再发任何信，但仍报告真实总数', async () => {
    await seedSubscribers(2)
    const c = await newCampaign('alldone')
    // 手工把两人都写进台账，再把状态置回 failed(模拟"发完了但收尾写状态失败")。
    await db
      .insert(emailDelivery)
      .values([
        { campaignId: c.id, email: mail('r0') },
        { campaignId: c.id, email: mail('r1') },
      ])
    await db.update(emailCampaign).set({ status: 'failed' }).where(eq(emailCampaign.id, c.id))

    expect(await sendCampaignCore(superAdmin, c.id)).toEqual({ recipientCount: 2 })
    // 一封信都不该再发出去 —— 这正是 alreadyCount 作为种子的意义。
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('卡在 sending 超过陈旧窗口的可被回收', async () => {
    await seedSubscribers(1)
    const c = await newCampaign('stale')
    // 模拟"崩溃留下的 sending":状态 sending,updatedAt 推到陈旧窗口之外。
    await db
      .update(emailCampaign)
      .set({ status: 'sending', updatedAt: new Date(Date.now() - STALE_SENDING_MS - 60_000) })
      .where(eq(emailCampaign.id, c.id))
    sendMock.mockImplementation(async (msgs: { to: string }[]) => ({
      delivered: msgs.map((m) => m.to),
      failed: [],
    }))
    expect(await sendCampaignCore(superAdmin, c.id)).toEqual({ recipientCount: 1 })
  })

  it('刚进入 sending(窗口内)的不可被回收 —— 慢但活着的发送不会被二次抢占', async () => {
    await seedSubscribers(1)
    const c = await newCampaign('fresh')
    await db
      .update(emailCampaign)
      .set({ status: 'sending', updatedAt: new Date() })
      .where(eq(emailCampaign.id, c.id))
    await expect(sendCampaignCore(superAdmin, c.id)).rejects.toThrow(/已发送或正在发送/)
  })
})
