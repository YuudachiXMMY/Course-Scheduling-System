import { listContactsCore } from '@/lib/site/admin-core'
import { requireSiteAdmin } from '@/lib/site/authz'
import { parsePagination } from '@/lib/site/pagination'
import { exportContacts } from '../actions'
import PaginationNav from '../pagination-nav'
import ExportButton from '../export-button'
import ContactsTable from './contacts-table'

// 询盘收件箱。只读 + CSV 导出。
//
// 官网表单在写 locale/grade/programs/topic/source/status/notes 七个资格字段(改版 PRD 加的),
// 官网自己的 /admin 从来没展示过它们。这里把它们放进可展开的行详情:列表只保留能扫的摘要,
// 点开才显示全部字段 —— 全摊成表格列会横向溢出，每列都窄到读不了。
//
// 仍未做:状态/备注的**编辑**(三态分诊)。本页是只读的，展开区里的状态和备注只显示不可改。

export default async function SiteContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // Next 16:searchParams 是 Promise，必须 await。
  const ctx = await requireSiteAdmin()
  const { contacts, pagination } = await listContactsCore(ctx, parsePagination(await searchParams))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-neutral-700 tabular-nums">
          询盘（{pagination.total}）
        </h3>
        {/* 列映射在 action 里(服务端)——普通函数不能跨 Server→Client 边界。 */}
        <ExportButton fetchRows={exportContacts} />
      </div>

      {/* 整行照传(每一列都在展开区里用到)。Date 可以跨 Server→Client 边界;ContactsTable
          自己声明 ContactView,所以这里不会把 server-only 的 ContactRow 类型拖进客户端。 */}
      <ContactsTable contacts={contacts} />

      <PaginationNav basePath="/dashboard/site/contacts" pagination={pagination} />
    </div>
  )
}
