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
