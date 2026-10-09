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

// ── 询盘的资格字段 ──────────────────────────────────────────────────────────────────────────
// 取值由官网 /api/contact 的 zod enum 约束(见 ItahcaFA-web 的 contactSchema),但这里**不**把
// 未知值吞掉 —— 官网加一个新选项时，控制台应当显示那个原始值让人看见，而不是显示"—"把它
// 伪装成"没填"。签名也照着各列的真实可空性写:locale/topic 可空，status 有默认值不可空。

export function contactLocaleLabel(locale: string | null | undefined): string {
  if (!locale) return '—'
  if (locale === 'zh') return '中文'
  if (locale === 'en') return '英文'
  return locale
}

export function contactTopicLabel(topic: string | null | undefined): string {
  if (!topic) return '—'
  const map: Record<string, string> = {
    program: '项目咨询',
    join: '加入我们',
    general: '一般咨询',
  }
  return map[topic] ?? topic
}

export function contactStatusLabel(status: string): string {
  const map: Record<string, string> = {
    new: '新询盘',
    contacted: '已联系',
    closed: '已关闭',
  }
  return map[status] ?? status
}
