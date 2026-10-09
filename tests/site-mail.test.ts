import { describe, it, expect } from 'vitest'
import { assertTlsConfigSafe, splitSettled, type SendMailOptions } from '@/lib/mail'

// mail.ts 的两个纯函数。它们能脱离 env 驱动的 transport 单测，这正是当初把它们抽出来的理由
// —— 这两条是群发的安全与幂等基石，不该只靠"跑一次真实 SMTP"来验证。

describe('assertTlsConfigSafe — 默认拒绝不安全 TLS', () => {
  it('未开启不安全 TLS 时，任何主机都放行', () => {
    expect(() => assertTlsConfigSafe('mail.ithacateens.com', false)).not.toThrow()
    expect(() => assertTlsConfigSafe(undefined, false)).not.toThrow()
    expect(() => assertTlsConfigSafe('stalwart', false)).not.toThrow()
  })

  it('内网别名 stalwart 允许开启不安全 TLS', () => {
    // 该别名的证书永远对不上公网主机名，这是用内网路径的唯一办法，且流量不出可信内网。
    expect(() => assertTlsConfigSafe('stalwart', true)).not.toThrow()
  })

  for (const host of [
    'mail.ithacateens.com',
    'smtp.gmail.com',
    '127.0.0.1',
    '::1',
    'unknown-host',
    '',
  ]) {
    it(`在 "${host}" 上开启不安全 TLS 必须抛错`, () => {
      // fail closed:带点的 FQDN、IP 字面量、未知单段主机名一律按"看起来像公网"处理。
      // 这里要的是拒绝启动，而不是打条 warning 然后继续裸奔。
      expect(() => assertTlsConfigSafe(host, true)).toThrow(/拒绝启动/)
    })
  }

  it('主机未设置却开启不安全 TLS 也必须抛错', () => {
    expect(() => assertTlsConfigSafe(undefined, true)).toThrow(/拒绝启动/)
  })
})

describe('splitSettled — 按下标切回收件人', () => {
  const msg = (to: string): SendMailOptions => ({ to, subject: 's', html: 'h' })

  it('全部成功', () => {
    const messages = [msg('a@x.com'), msg('b@x.com')]
    const results: PromiseSettledResult<void>[] = [
      { status: 'fulfilled', value: undefined },
      { status: 'fulfilled', value: undefined },
    ]
    expect(splitSettled(messages, results)).toEqual({
      delivered: ['a@x.com', 'b@x.com'],
      failed: [],
    })
  })

  it('部分失败:成功的进 delivered，失败的带上原因', () => {
    // 这是幂等的关键 —— 只有 delivered 会被写进台账，所以切分必须严格按下标对齐，
    // 错位一格就会把一个没收到信的人标记为已送达(永久漏发)。
    const messages = [msg('a@x.com'), msg('b@x.com'), msg('c@x.com')]
    const results: PromiseSettledResult<void>[] = [
      { status: 'fulfilled', value: undefined },
      { status: 'rejected', reason: new Error('mailbox full') },
      { status: 'fulfilled', value: undefined },
    ]
    expect(splitSettled(messages, results)).toEqual({
      delivered: ['a@x.com', 'c@x.com'],
      failed: [{ to: 'b@x.com', error: 'mailbox full' }],
    })
  })

  it('非 Error 的 reason 也要转成字符串，不能变成 undefined', () => {
    const results: PromiseSettledResult<void>[] = [{ status: 'rejected', reason: 'plain string' }]
    expect(splitSettled([msg('a@x.com')], results).failed).toEqual([
      { to: 'a@x.com', error: 'plain string' },
    ])
  })

  it('空批次', () => {
    expect(splitSettled([], [])).toEqual({ delivered: [], failed: [] })
  })
})
