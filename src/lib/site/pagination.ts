// 官网控制台列表页的分页解析 —— 纯函数，无 DB。
// 从官网仓 src/lib/server/pagination.ts 移植;入参由 URL 改为 Next 的 searchParams 记录，
// 因为 Server Component 拿到的是 `{ [k]: string | string[] | undefined }` 而不是 URL 对象。

export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 100

/** 由 `?page` / `?limit` 推导出的分页入参。 */
export interface PageQuery {
  page: number
  limit: number
  offset: number
}

export interface Pagination {
  total: number
  page: number
  limit: number
  totalPages: number
}

// Next 的 searchParams 对同名重复参数给数组(?page=1&page=2)。取第一个即可 —— 行为确定，
// 且不会把数组喂给 parseInt(那会得到 NaN，进而落到默认值，掩盖掉用户的真实意图)。
function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

/**
 * 解析 `?page` / `?limit`。
 *
 * 非数字参数 parseInt → NaN，而 Math.max/min 会把 NaN 一路传播到 limit/offset，
 * 最终让 SQL 收到 NaN 而报错。所以这里显式用 Number.isFinite 兜回默认值 ——
 * 这是官网侧修过的坑，移植时必须跟着带过来。
 */
export function parsePagination(params: Record<string, string | string[] | undefined>): PageQuery {
  const rawPage = parseInt(first(params.page) ?? '1', 10)
  const rawLimit = parseInt(first(params.limit) ?? String(DEFAULT_PAGE_SIZE), 10)
  const page = Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1
  const limit = Number.isFinite(rawLimit)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, rawLimit))
    : DEFAULT_PAGE_SIZE
  return { page, limit, offset: (page - 1) * limit }
}

/** 列表旁边一起返回的分页信封。 */
export function buildPagination(total: number, page: number, limit: number): Pagination {
  return { total, page, limit, totalPages: Math.ceil(total / limit) }
}

/**
 * 把请求的页码夹到实际存在的最后一页。
 *
 * 为什么需要:超出范围的页码会查出空结果，于是界面显示"暂无数据"——但数据明明还在，只是在
 * 前面的页上。运营方看到的是"数据没了"。触发方式不止一种:
 *   · 在第 2 页删掉最后一行(官网原版为此专门写了"退一页"的前端逻辑);
 *   · 另一个管理员并发删除;
 *   · 书签/历史记录里的深链接;
 *   · 手敲 URL。
 *
 * 所以夹取放在服务端而不是删除按钮里 —— 一处修好，上面四种全都覆盖，而照搬原版的客户端
 * 退页逻辑只能覆盖第一种。
 *
 * 返回 null 表示请求的页码本来就有效(不必重查)。
 */
export function clampPage(q: PageQuery, total: number): PageQuery | null {
  if (total === 0) return null // 空表:停在第 1 页，"暂无数据"此时是**真话**
  const totalPages = Math.ceil(total / q.limit)
  if (q.page <= totalPages) return null
  return { page: totalPages, limit: q.limit, offset: (totalPages - 1) * q.limit }
}
