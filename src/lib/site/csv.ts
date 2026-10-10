// CSV 序列化 —— 纯函数，无 server-only(客户端导出按钮也要 import)。
// 从官网仓 src/lib/utils.ts 的 sanitizeCsvCell / toCsv 逐字移植。

/**
 * 中和电子表格公式注入(CWE-1236):首字符为 =、+、-、@、TAB(0x09)、CR(0x0D) 的单元格
 * 会被 Excel/Sheets/LibreOffice 当公式执行。给这类单元格加一个单引号前缀，使其渲染为惰性文本。
 *
 * 这件事在这里格外要紧:这些单元格的内容来自**公开表单**(姓名、留言、来源都是访客自由填写),
 * 导出的 CSV 又会在运营方自己的 Excel 里打开 —— 一条 `=HYPERLINK(...)` 的"姓名"就能在
 * 对方机器上执行。
 *
 * CSV 语法层面的转义(把 " 变成 "")是**另一件事**，在 join 处处理。
 */
export function sanitizeCsvCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

/**
 * 表头行 + 数据行 → CSV 字符串:每个单元格先做公式注入中和，再把 `"` 翻倍并整体加引号;
 * 单元格用 `,` 连接、行用 `\n` 连接。
 *
 * 全部单元格一律加引号(而不是只给含逗号的加)——这样含逗号、引号、换行的内容都无需特判。
 */
export function toCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows]
    .map((row) => row.map((cell) => `"${sanitizeCsvCell(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
}

/**
 * 序列化并触发浏览器下载，文件名为 `<prefix>-<YYYY-MM-DD>.csv`。仅浏览器可用
 * (依赖 Blob/URL/document)。
 *
 * BOM(﻿)是官网版没有、这里特意加上的:Excel 在简体中文 Windows 上会按 GBK 解读
 * 无 BOM 的 UTF-8 CSV，中文姓名和留言全变乱码。加 BOM 后 Excel 才认 UTF-8。
 */
export function downloadCsv(filenamePrefix: string, headers: string[], rows: string[][]): void {
  const blob = new Blob(['﻿' + toCsv(headers, rows)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${filenamePrefix}-${new Date().toISOString().split('T')[0]}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
