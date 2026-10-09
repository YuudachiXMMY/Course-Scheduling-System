import Link from 'next/link'
import type { Pagination } from '@/lib/site/pagination'

// 分页条。刻意**不是** Client Component:翻页就是换 URL，用 <Link> 让服务端重新渲染即可,
// 没有任何需要客户端状态的东西。官网原版把整个列表页做成客户端组件 + fetch 轮次,
// 于是必须自己处理"后发先至"(它为此写了一个 staleness token 的 loader)——换成链接式分页,
// 这个竞态在架构上就不存在了。
export default function PaginationNav({
  basePath,
  pagination,
}: {
  basePath: string
  pagination: Pagination
}) {
  const { page, totalPages, total, limit } = pagination
  if (total === 0) return null

  const prev = page > 1 ? page - 1 : null
  const next = page < totalPages ? page + 1 : null
  const from = (page - 1) * limit + 1
  const to = Math.min(page * limit, total)

  const cls = 'rounded-lg border border-neutral-200 px-3 py-1 text-sm hover:bg-neutral-50'
  const disabled = 'rounded-lg border border-neutral-100 px-3 py-1 text-sm text-neutral-300'

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-neutral-500 tabular-nums">
        第 {from}–{to} 条，共 {total} 条
      </p>
      <div className="flex items-center gap-2">
        {prev ? (
          <Link href={`${basePath}?page=${prev}`} className={cls}>
            上一页
          </Link>
        ) : (
          <span className={disabled}>上一页</span>
        )}
        <span className="text-xs text-neutral-500 tabular-nums">
          {page} / {totalPages}
        </span>
        {next ? (
          <Link href={`${basePath}?page=${next}`} className={cls}>
            下一页
          </Link>
        ) : (
          <span className={disabled}>下一页</span>
        )}
      </div>
    </div>
  )
}
