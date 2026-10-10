import { getSiteStatsCore } from '@/lib/site/admin-core'
import { requireSiteAdmin } from '@/lib/site/authz'

// 概览。官网原版在浏览器里并发拉四个列表接口、再在前端 filter 出数量 —— 那会把整张 campaign
// 表和整张 popup 表传到客户端只为数两个数，还带一个加载骨架屏。这里是 Server Component +
// 四条 COUNT(*),首屏直接是最终内容:没有客户端 fetch 瀑布，也没有骨架屏闪一下。
//
// 授权:layout 已挡非超管，getSiteStatsCore 内部还会再查一次(纵深防御)。

const CARDS = [
  { key: 'totalContacts', label: '询盘总数' },
  { key: 'totalSubscribers', label: '订阅者总数' },
  { key: 'campaignsSent', label: '已发送邮件' },
  { key: 'activePopups', label: '启用中的弹窗' },
] as const

export default async function SiteOverviewPage() {
  const stats = await getSiteStatsCore(await requireSiteAdmin())
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {CARDS.map((c) => (
        <div key={c.key} className="rounded-xl border border-neutral-200 p-5">
          <p className="text-sm text-neutral-500">{c.label}</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums">{stats[c.key]}</p>
        </div>
      ))}
    </div>
  )
}
