'use client'

import { useState, useTransition } from 'react'
import { downloadCsv } from '@/lib/site/csv'
import type { ExportResult } from './actions'

// CSV 导出按钮。首屏不预载全量数据 —— 点了才去 action 取，所以列表页只渲染当前一页。
//
// 边界上**只有一个 Server Action** 跨过去。早先的写法额外传了一个 `toRow` 映射函数,
// 那是行不通的:普通函数无法序列化到 Client Component,React 会抛
// "Functions cannot be passed directly to Client Components",结果整个按钮静默不渲染
// (tsc 和 eslint 都看不出来,只有真跑页面才暴露)。现在列映射留在服务端的 action 里,
// 这个组件只负责"取 → 失败则内联提示 → 成功则下载"。
export default function ExportButton({
  fetchRows,
  label = '导出 CSV',
}: {
  fetchRows: () => Promise<ExportResult>
  label?: string
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function run() {
    setError(null)
    startTransition(async () => {
      // action 永不抛(它返回 { ok } 判别式),但网络层本身仍可能失败 —— 不 catch 的话
      // transition 里的拒绝会被上抛到错误边界，整页被通用错误屏替换。
      try {
        const res = await fetchRows()
        if (!res.ok) {
          setError(res.error)
          return
        }
        if (res.rows.length === 0) {
          setError('暂无数据可导出')
          return
        }
        downloadCsv(res.filename, res.headers, res.rows)
      } catch {
        setError('导出失败，请稍后重试')
      }
    })
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="rounded-lg border border-neutral-200 px-3 py-1 text-sm hover:bg-neutral-50 disabled:opacity-50"
      >
        {pending ? '导出中…' : label}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}
