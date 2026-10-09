// 群发收件人切分 —— 纯函数，无 DB(单元测试见 tests/site-recipients.test.ts)。
// 从官网仓 src/routes/api/admin/emails/send/recipients.ts 逐字移植。
//
// `activeEmails` = 当前 status='active' 的订阅者;`deliveredEmails` = 本次 campaign 的投递台账。
// `pending` = 仍需发送的;`alreadyCount` = 台账里已送达的去重人数。
// 真实的 recipientCount(实际送达总数)由调用方在发送结束后算出 —— 用 alreadyCount 作种子，
// 所以"已全部送达后再点一次重试"(pending 为空、循环不执行)依然报告正确总数。
export function partitionRecipients(
  activeEmails: string[],
  deliveredEmails: string[],
): { pending: string[]; alreadyCount: number } {
  const already = new Set(deliveredEmails)
  const pending = activeEmails.filter((email) => !already.has(email))
  return { pending, alreadyCount: already.size }
}
