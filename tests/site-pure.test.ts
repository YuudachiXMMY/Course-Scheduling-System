import { describe, it, expect } from 'vitest'
import { partitionRecipients } from '@/lib/site/recipients'
import {
  parsePagination,
  buildPagination,
  clampPage,
  DEFAULT_PAGE_SIZE,
} from '@/lib/site/pagination'
import { toLocalInput, fromLocalInput } from '@/lib/site/form-time'
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

describe('clampPage — 越界页码不得渲染成"暂无数据"', () => {
  const q = (page: number, limit = 20) => ({ page, limit, offset: (page - 1) * limit })

  it('页码有效时返回 null(不必重查)', () => {
    expect(clampPage(q(1), 21)).toBeNull()
    expect(clampPage(q(2), 21)).toBeNull()
  })

  it('删掉第 2 页最后一行后:请求第 2 页但只剩 20 条 → 夹到第 1 页', () => {
    // 这正是官网原版用前端"退一页"逻辑规避的那个场景。放在服务端夹取还能覆盖深链接、
    // 他人并发删除、手敲 URL —— 那三种前端退页逻辑都管不到。
    expect(clampPage(q(2), 20)).toEqual({ page: 1, limit: 20, offset: 0 })
  })

  it('远超范围的页码夹到最后一页，而不是第 1 页', () => {
    // 夹到最后一页而非第一页:用户的意图是"看靠后的记录"，把他扔回第 1 页会丢失这个意图。
    expect(clampPage(q(99), 45)).toEqual({ page: 3, limit: 20, offset: 40 })
  })

  it('空表返回 null —— 此时"暂无数据"是真话，不该重查', () => {
    expect(clampPage(q(1), 0)).toBeNull()
    expect(clampPage(q(5), 0)).toBeNull()
  })

  it('恰好填满最后一页时不夹取', () => {
    expect(clampPage(q(2), 40)).toBeNull() // 40 条 / 每页 20 = 正好 2 页
    expect(clampPage(q(3), 40)).toEqual({ page: 2, limit: 20, offset: 20 })
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

describe('datetime-local ↔ ISO 往返（APP_TIME_ZONE = America/Toronto）', () => {
  it('填进去的挂钟时间必须原样回来', () => {
    // 这是整件事的要点:运营方填"晚上八点"，存的得是多伦多的晚上八点。少了显式时区解读,
    // 它会被当成 UTC 八点，在多伦多显示成下午三四点。
    const r = fromLocalInput('2026-06-15T20:00')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(toLocalInput(new Date(r.iso!))).toBe('2026-06-15T20:00')
  })

  it('冬令时（EST，-05:00）与夏令时（EDT，-04:00）都正确', () => {
    const summer = fromLocalInput('2026-07-01T12:00')
    const winter = fromLocalInput('2026-01-01T12:00')
    expect(summer.ok && summer.iso).toContain('-04:00')
    expect(winter.ok && winter.iso).toContain('-05:00')
  })

  it('空串表示"未设置"，不是错误', () => {
    expect(fromLocalInput('')).toEqual({ ok: true, iso: null })
    expect(toLocalInput(null)).toBe('')
  })

  it('夏令时跳表的那一小时必须被拒，而不是被静默挪后一小时', () => {
    // 2026-03-08 多伦多 02:00 直接跳到 03:00,02:30 这个挂钟时刻根本不存在。
    // Luxon 对它 isValid === true 并静默返回 03:30 —— 所以 .isValid 守不住，必须折回比对。
    const r = fromLocalInput('2026-03-08T02:30')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toBe('该时刻不存在（夏令时跳表）')
  })

  it('秋季回拨的重复小时**可以**接受（该时刻确实存在，只是出现两次）', () => {
    // 与跳表相反:11-01 01:30 在多伦多出现两次。Luxon 取第一次(EDT)。这不是错误 ——
    // 拒掉它会让一个合法时间无法填写，而两次之间的差别对弹窗时间窗没有实际意义。
    const r = fromLocalInput('2026-11-01T01:30')
    expect(r.ok).toBe(true)
  })

  it('格式错误与"时刻不存在"报不同的原因', () => {
    // 两者混为一谈会让人对着一个格式完全正确的输入反复检查格式。
    const bad = fromLocalInput('not-a-date')
    expect(bad.ok).toBe(false)
    expect(!bad.ok && bad.reason).toBe('格式不正确')
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
