import 'server-only'
import { timingSafeEqual } from 'node:crypto'
import { env } from '@/env'

// /api/site/* 的主体验证:官网(ithacateens.com)服务端携带共享密钥调用本项目。
// 做法照 /api/cron/reminders 的既有约定 —— 恒定时间比对，未配置即 401 惰性，绝不 fail-open。
//
// 为什么是共享密钥而不是 Better Auth:调用方是一个**服务**，没有也不该有用户会话。
// 给它造一个长期有效的用户账号反而扩大了攻击面(那个账号能登控制台)。

/**
 * 校验请求头里的密钥。
 *
 * 返回 null 表示通过;否则返回要直接回给调用方的 401 响应。
 *
 * fail closed 的三种情况都返回 401:
 *   · 服务器未配置 SITE_INGEST_SECRET → 端点保持惰性(官网还没接上时不该意外放行);
 *   · 请求没带密钥;
 *   · 密钥不匹配(含长度不同 —— timingSafeEqual 在长度不等时会抛，必须先挡)。
 *
 * 响应体刻意不区分这三者:对探测者来说"为什么被拒"本身就是情报。
 */
export function checkIngestSecret(req: Request): Response | null {
  const provided = req.headers.get('x-site-secret') ?? undefined
  const expected = env.SITE_INGEST_SECRET
  if (!expected || !provided) return unauthorized()
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  // 长度守卫:timingSafeEqual 在长度不等时抛异常，所以不能省。长度本身会泄漏(这是
  // timingSafeEqual 的固有限制)，但密钥是 48 字节随机值，长度不构成可利用的情报。
  if (a.length !== b.length || !timingSafeEqual(a, b)) return unauthorized()
  return null
}

function unauthorized(): Response {
  return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
}
