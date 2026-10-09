import { listContactsCore } from '@/lib/site/admin-core'
import { requireSiteAdmin } from '@/lib/site/authz'
import { parsePagination } from '@/lib/site/pagination'
import { formatDateTime } from '@/lib/format-datetime'
import { exportContacts } from '../actions'
import PaginationNav from '../pagination-nav'
import ExportButton from '../export-button'

// 询盘收件箱。只读 + CSV 导出 —— 与官网原版功能对等。
//
// 有意未做:官网的 contact_messages 里已经有改版 PRD 加的 locale/grade/programs/topic/source/
// status/notes 七个字段(官网表单在写它们),但官网自己的 /admin 询盘页从来没展示过。这里按
// 严格对等移植，列已经建好、数据照常写入，展示和三态分诊留作后续一笔(见 PR 描述)。

const CSV_HEADERS = ['姓名', '邮箱', '电话', '留言', '是否订阅', '提交时间']

export default async function SiteContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // Next 16:searchParams 是 Promise，必须 await。
  const ctx = await requireSiteAdmin()
  const { contacts, pagination } = await listContactsCore(
    ctx,
    parsePagination(await searchParams),
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-neutral-700 tabular-nums">
          询盘（{pagination.total}）
        </h3>
        <ExportButton
          filenamePrefix="contacts"
          headers={CSV_HEADERS}
          fetchRows={exportContacts}
          toRow={(c) => [
            c.name,
            c.email,
            c.phone ?? '',
            c.message ?? '',
            c.subscribe ? '是' : '否',
            formatDateTime(c.createdAt),
          ]}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">姓名</th>
              <th className="px-4 py-2 font-medium">邮箱</th>
              <th className="px-4 py-2 font-medium">电话</th>
              <th className="px-4 py-2 font-medium">留言</th>
              <th className="px-4 py-2 font-medium">订阅</th>
              <th className="px-4 py-2 font-medium">提交时间</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {contacts.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-neutral-500">
                  暂无询盘
                </td>
              </tr>
            )}
            {contacts.map((c) => (
              <tr key={c.id} className="align-top">
                <td className="px-4 py-2 whitespace-nowrap">{c.name}</td>
                <td className="px-4 py-2 whitespace-nowrap">
                  <a href={`mailto:${c.email}`} className="text-neutral-700 hover:underline">
                    {c.email}
                  </a>
                </td>
                <td className="px-4 py-2 whitespace-nowrap">{c.phone ?? '—'}</td>
                {/* 留言可能很长:限宽 + 换行，而不是让它把表格撑破。 */}
                <td className="max-w-md px-4 py-2 break-words whitespace-pre-wrap">
                  {c.message ?? '—'}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">{c.subscribe ? '是' : '否'}</td>
                <td className="px-4 py-2 whitespace-nowrap tabular-nums">
                  {formatDateTime(c.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PaginationNav basePath="/dashboard/site/contacts" pagination={pagination} />
    </div>
  )
}
