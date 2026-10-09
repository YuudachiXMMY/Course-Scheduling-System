import { listSubscribersCore } from '@/lib/site/admin-core'
import { requireSiteAdmin } from '@/lib/site/authz'
import { subscriberStatusLabel } from '@/lib/site/labels'
import { parsePagination } from '@/lib/site/pagination'
import { formatDateTime } from '@/lib/format-datetime'
import { exportSubscribers } from '../actions'
import PaginationNav from '../pagination-nav'
import ExportButton from '../export-button'
import DeleteSubscriberButton from './delete-subscriber-button'

// 订阅者。列表 + 删除 + CSV 导出 —— 与官网原版功能对等。
//
// status 是 'active' | 'unsubscribed':退订的人**留在表里**而不是被删掉，这样"此人已明确
// 退订"是一条可查的事实，而不是"查不到就当没订过"。群发只发给 active。

export default async function SiteSubscribersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireSiteAdmin()
  const { subscribers, pagination } = await listSubscribersCore(
    ctx,
    parsePagination(await searchParams),
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-neutral-700 tabular-nums">
          订阅者（{pagination.total}）
        </h3>
        {/* 列映射在 action 里(服务端)——普通函数不能跨 Server→Client 边界。 */}
        <ExportButton fetchRows={exportSubscribers} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">邮箱</th>
              <th className="px-4 py-2 font-medium">姓名</th>
              <th className="px-4 py-2 font-medium">状态</th>
              <th className="px-4 py-2 font-medium">订阅时间</th>
              <th className="px-4 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {subscribers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-neutral-500">
                  暂无订阅者
                </td>
              </tr>
            )}
            {subscribers.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-2 whitespace-nowrap">{s.email}</td>
                <td className="px-4 py-2 whitespace-nowrap">{s.name ?? '—'}</td>
                <td className="px-4 py-2 whitespace-nowrap">
                  <span
                    className={
                      s.status === 'active'
                        ? 'rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700'
                        : 'rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600'
                    }
                  >
                    {subscriberStatusLabel(s.status)}
                  </span>
                </td>
                <td className="px-4 py-2 whitespace-nowrap tabular-nums">
                  {formatDateTime(s.subscribedAt)}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  <DeleteSubscriberButton id={s.id} email={s.email} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PaginationNav basePath="/dashboard/site/subscribers" pagination={pagination} />
    </div>
  )
}
