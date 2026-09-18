import { describe, it, expect } from 'vitest'
import { isAllowedPushEndpoint, saveSubscriptionSchema } from '@/lib/push-endpoint'

// 评审 Slice B — Web Push SSRF 白名单守卫。
describe('isAllowedPushEndpoint — 推送服务主机白名单', () => {
  it('接受已知推送服务的 https 端点', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc123')).toBe(true)
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/xyz')).toBe(true)
    expect(isAllowedPushEndpoint('https://web.push.apple.com/QABC')).toBe(true)
    expect(isAllowedPushEndpoint('https://db5p.notify.windows.com/w/?token=AAA')).toBe(true)
  })

  it('拒绝 http、私网/环回、云元数据、任意主机', () => {
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/abc')).toBe(false) // 非 https
    expect(isAllowedPushEndpoint('http://169.254.169.254/latest/meta-data/')).toBe(false)
    expect(isAllowedPushEndpoint('https://169.254.169.254/latest/meta-data/')).toBe(false)
    expect(isAllowedPushEndpoint('https://10.0.0.5/internal')).toBe(false)
    expect(isAllowedPushEndpoint('https://localhost:5433/')).toBe(false)
    expect(isAllowedPushEndpoint('https://evil.example.com/fcm/send')).toBe(false)
    expect(isAllowedPushEndpoint('https://evilnotify.windows.com/w/')).toBe(false) // 后缀 look-alike
    expect(isAllowedPushEndpoint('not-a-url')).toBe(false)
  })
})

describe('saveSubscriptionSchema — endpoint + base64url 校验', () => {
  const good = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    p256dh: 'BLc4xRzKlKORKWlbdgFaBrrPK3ydWAHo4M0gs0i1oEKgPpWC5cW8OCzVrOQRv-1npXRWk8udnW3oYhIO4475rds',
    auth: 'tBHItJI5svbpez7KI4CCXg',
  }
  it('接受合法订阅', () => {
    expect(saveSubscriptionSchema.safeParse(good).success).toBe(true)
  })
  it('拒绝非白名单 endpoint', () => {
    const r = saveSubscriptionSchema.safeParse({ ...good, endpoint: 'https://evil.example.com/x' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.message).toBe('不受支持的推送服务地址')
  })
  it('拒绝非 base64url 的 p256dh/auth', () => {
    expect(saveSubscriptionSchema.safeParse({ ...good, p256dh: 'has spaces!!' }).success).toBe(false)
    expect(saveSubscriptionSchema.safeParse({ ...good, auth: 'a==' }).success).toBe(false)
  })
})
