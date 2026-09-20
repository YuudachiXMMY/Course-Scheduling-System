import { requireAuthContext } from '@/auth/context'
import { requirePagePermission } from '@/auth/authorize'
import { env } from '@/env'
import { getActiveFeed } from './data'
import FeedPanel from './feed-panel'

export default async function CalendarSettingsPage() {
  const ctx = await requireAuthContext()
  requirePagePermission(ctx, { lesson: ['read'] })

  const feed = await getActiveFeed(ctx)
  const httpsUrl = feed ? `${env.NEXT_PUBLIC_APP_URL}/api/calendar/${feed.token}` : null
  // webcal:// is https:// with the scheme swapped — Apple/Google treat it as "subscribe" (not download).
  const webcalUrl = httpsUrl ? httpsUrl.replace(/^https?:/, 'webcal:') : null

  return (
    <section className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">日历订阅</h2>
        <p className="text-sm text-neutral-600">
          把你排的课单向同步到 Apple 日历 / Google
          日历。链接只读、无需登录，泄露后可随时重新生成使旧链接失效。
        </p>
      </div>

      <FeedPanel hasFeed={!!feed} httpsUrl={httpsUrl} webcalUrl={webcalUrl} />

      <div className="flex flex-col gap-3 text-sm text-neutral-700">
        <div>
          <h3 className="font-medium">在 Apple 日历订阅</h3>
          <p className="text-neutral-600">
            点按 <code className="rounded bg-neutral-100 px-1">webcal://</code>{' '}
            链接即可一键订阅；或在「日历 → 文件 → 新建日历订阅」中粘贴该链接。
          </p>
        </div>
        <div>
          <h3 className="font-medium">在 Google 日历订阅</h3>
          <p className="text-neutral-600">
            打开 Google 日历 →「其他日历 → 通过网址添加」，粘贴{' '}
            <code className="rounded bg-neutral-100 px-1">https://</code> 形式的链接。
          </p>
        </div>
        <p className="text-xs text-neutral-500">
          订阅只包含最近 8 周至未来 26
          周的课节；已取消的课节会在客户端下次刷新时自动消失，改期不会产生重复事件。
        </p>
      </div>
    </section>
  )
}
