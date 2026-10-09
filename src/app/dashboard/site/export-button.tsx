'use client'

import { useState, useTransition } from 'react'
import { downloadCsv } from '@/lib/site/csv'

// CSV 导出按钮。首屏不预载全量数据 —— 点了才去 action 取，所以列表页只渲染当前一页。
//
// 泛型化:询盘和订阅者的列类型不同，但"取数 → 失败则内联提示 → 成功则下载"这套流程完全一样。
export default function ExportButton<Row>({
  filenamePrefix,
  headers,
  fetchRows,
  toRow,
  label = '导出 CSV',
}: {
  filenamePrefix: string
  headers: string[]
  fetchRows: () => Promise<{ ok: true; rows: Row[] } | { ok: false; error: string }>
  toRow: (row: Row) => string[]
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
        downloadCsv(filenamePrefix, headers, res.rows.map(toRow))
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
