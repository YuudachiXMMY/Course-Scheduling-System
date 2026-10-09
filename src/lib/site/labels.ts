// 官网控制台的显示文案 —— 纯函数、无 server-only,Server Component 和 Client Component 都能 import。
// 单独成文件是因为列表页(显示)和导出 action(写进 CSV)必须用**同一份**映射:两边各写一遍,
// 迟早会出现界面显示"已退订"而导出里是 "unsubscribed" 的情况。

export function subscriberStatusLabel(status: string): string {
  if (status === 'active') return '订阅中'
  if (status === 'unsubscribed') return '已退订'
  return status // 未知状态原样显示，而不是悄悄归类成某一种
}

export function campaignStatusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: '草稿',
    sending: '发送中',
    sent: '已发送',
    failed: '失败',
  }
  return map[status] ?? status
}
