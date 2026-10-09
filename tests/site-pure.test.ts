import { describe, it, expect } from 'vitest'
import { partitionRecipients } from '@/lib/site/recipients'
import { parsePagination, buildPagination, DEFAULT_PAGE_SIZE } from '@/lib/site/pagination'
import { isPopupLive } from '@/lib/site/popup-active'
import { createPopupSchema, siteContactSchema, siteSubscribeSchema } from '@/lib/site/schemas'

// 官网 /admin 移植的纯逻辑。每个用例钉住的都是"移植时最容易被悄悄简化掉"的那一条性质 ——
// 幂等重试的收件人切分、NaN 分页、弹窗时间窗四分支、以及拒掉 javascript: 的 CTA 链接。

describe('partitionRecipients — 群发重试幂等', () => {
  it('首次发送:全部待发，已送达为 0', () => {
    expect(partitionRecipients(['a@x.com', 'b@x.com'], [])).toEqual({
      pending: ['a@x.com', 'b@x.com'],
      alreadyCount: 0,
    })
  })

  it('部分失败后重试:只补发未入账的那部分', () => {
    expect(partitionRecipients(['a@x.com', 'b@x.com', 'c@x.com'], ['a@x.com'])).toEqual({
      pending: ['b@x.com', 'c@x.com'],
      alreadyCount: 1,
    })
  })

  it('已全部送达后再重试:无人待发，但 alreadyCount 保留真实总数', () => {
    // 这一条是 recipientCount 正确性的关键:循环不执行，总数只能来自 alreadyCount。
    expect(partitionRecipients(['a@x.com', 'b@x.com'], ['a@x.com', 'b@x.com'])).toEqual({
      pending: [],
      alreadyCount: 2,
    })
  })

  it('台账里已退订的收件人不会把自己算回待发名单', () => {
    // 台账可能含有"当时是订阅者、现在已退订"的人。他们不在 activeEmails 里，所以不该待发，
    // 但仍计入 alreadyCount(他们确实收到了这封信)。
    expect(partitionRecipients(['a@x.com'], ['a@x.com', 'gone@x.com'])).toEqual({
      pending: [],
      alreadyCount: 2,
    })
  })
})

describe('parsePagination — NaN 不得泄漏到 SQL', () => {
  it('缺省参数走默认值', () => {
    expect(parsePagination({})).toEqual({ page: 1, limit: DEFAULT_PAGE_SIZE, offset: 0 })
  })

  it('正常参数算出 offset', () => {
    expect(parsePagination({ page: '3', limit: '10' })).toEqual({ page: 3, limit: 10, offset: 20 })
  })

  it('非数字参数回落到默认值，而不是把 NaN 传下去', () => {
    // Math.max/min 会把 NaN 原样传播 —— 没有 Number.isFinite 守卫的话 limit/offset 都是 NaN，
    // 最终让 Postgres 在 LIMIT NaN 上报错。
    const q = parsePagination({ page: 'abc', limit: 'xyz' })
    expect(q).toEqual({ page: 1, limit: DEFAULT_PAGE_SIZE, offset: 0 })
    expect(Number.isNaN(q.offset)).toBe(false)
  })

  it('越界参数被夹到合法区间', () => {
    expect(parsePagination({ page: '0' }).page).toBe(1)
    expect(parsePagination({ page: '-5' }).page).toBe(1)
    expect(parsePagination({ limit: '9999' }).limit).toBe(100)
    expect(parsePagination({ limit: '0' }).limit).toBe(1)
  })

  it('重复同名参数取第一个(Next 给的是数组)', () => {
    expect(parsePagination({ page: ['2', '7'] }).page).toBe(2)
  })

  it('buildPagination 的 totalPages 向上取整，空列表为 0 页', () => {
    expect(buildPagination(0, 1, 20)).toEqual({ total: 0, page: 1, limit: 20, totalPages: 0 })
    expect(buildPagination(21, 1, 20).totalPages).toBe(2)
    expect(buildPagination(40, 1, 20).totalPages).toBe(2)
  })
})

describe('isPopupLive — 时间窗四分支', () => {
  const now = new Date('2026-06-15T12:00:00Z')
  const past = new Date('2026-06-01T00:00:00Z')
  const future = new Date('2026-07-01T00:00:00Z')

  it('未启用的弹窗永不生效，哪怕时间窗正合适', () => {
    expect(isPopupLive({ isActive: false, startDate: past, endDate: future }, now)).toBe(false)
  })

  it('两端皆空 = 永久生效', () => {
    expect(isPopupLive({ isActive: true, startDate: null, endDate: null }, now)).toBe(true)
  })

  it('只有开始时间:已开始生效，未开始不生效', () => {
    expect(isPopupLive({ isActive: true, startDate: past, endDate: null }, now)).toBe(true)
    expect(isPopupLive({ isActive: true, startDate: future, endDate: null }, now)).toBe(false)
  })

  it('只有结束时间:未到期生效，已过期不生效', () => {
    expect(isPopupLive({ isActive: true, startDate: null, endDate: future }, now)).toBe(true)
    expect(isPopupLive({ isActive: true, startDate: null, endDate: past }, now)).toBe(false)
  })

  it('两端都有:窗内生效，窗外不生效', () => {
    expect(isPopupLive({ isActive: true, startDate: past, endDate: future }, now)).toBe(true)
    expect(isPopupLive({ isActive: true, startDate: future, endDate: future }, now)).toBe(false)
    expect(isPopupLive({ isActive: true, startDate: past, endDate: past }, now)).toBe(false)
  })

  it('边界是闭区间:开始时刻与结束时刻本身都算生效', () => {
    // 原 Prisma 查询用 lte / gte，移植必须保持闭区间 —— 改成开区间会让"整点开始"的弹窗
    // 在它唯一有意义的那一刻不显示。
    expect(isPopupLive({ isActive: true, startDate: now, endDate: null }, now)).toBe(true)
    expect(isPopupLive({ isActive: true, startDate: null, endDate: now }, now)).toBe(true)
  })
})

describe('createPopupSchema — CTA 链接的存储型 XSS 防线', () => {
  const base = { title: 't', content: 'c', isActive: true }

  it('放行 http(s)', () => {
    expect(createPopupSchema.safeParse({ ...base, buttonLink: 'https://x.com/a' }).success).toBe(
      true,
    )
    expect(createPopupSchema.safeParse({ ...base, buttonLink: 'http://x.com' }).success).toBe(true)
  })

  it('空串视为未填，放行', () => {
    expect(createPopupSchema.safeParse({ ...base, buttonLink: '' }).success).toBe(true)
  })

  for (const bad of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    '//evil.com',
    'mailto:a@b.com',
    'vbscript:msgbox(1)',
  ]) {
    it(`拒掉 ${bad}`, () => {
      // 这个值会进官网每个访客的 <a href>。裸 z.string().url() 放过前两类，所以必须有
      // 显式的 ^https?:// 白名单，而不是只靠 .url()。
      expect(createPopupSchema.safeParse({ ...base, buttonLink: bad }).success).toBe(false)
    })
  }

  it('标题/内容不能为空', () => {
    expect(createPopupSchema.safeParse({ ...base, title: '' }).success).toBe(false)
    expect(createPopupSchema.safeParse({ ...base, content: '' }).success).toBe(false)
  })
})

describe('官网写入端点的第二道校验', () => {
  it('合法询盘通过，programs 缺省为空数组', () => {
    const r = siteContactSchema.safeParse({ name: 'A', email: 'a@x.com' })
    expect(r.success).toBe(true)
    expect(r.success && r.data.programs).toEqual([])
  })

  it('年级越界被拒(学院只服务 4–12 年级)', () => {
    expect(siteContactSchema.safeParse({ name: 'A', email: 'a@x.com', grade: 3 }).success).toBe(
      false,
    )
    expect(siteContactSchema.safeParse({ name: 'A', email: 'a@x.com', grade: 13 }).success).toBe(
      false,
    )
  })

  it('programs 数量超上限被拒(体积约束，不是枚举约束)', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    expect(
      siteContactSchema.safeParse({ name: 'A', email: 'a@x.com', programs: many }).success,
    ).toBe(false)
  })

  it('非法邮箱被拒', () => {
    expect(siteContactSchema.safeParse({ name: 'A', email: 'not-an-email' }).success).toBe(false)
    expect(siteSubscribeSchema.safeParse({ email: 'nope' }).success).toBe(false)
  })

  it('name 缺失被拒 —— 官网校验过不等于这里可以免检', () => {
    expect(siteContactSchema.safeParse({ email: 'a@x.com' }).success).toBe(false)
  })
})
