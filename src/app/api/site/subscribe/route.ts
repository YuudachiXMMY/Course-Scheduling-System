import { checkIngestSecret } from '@/lib/site/ingest-auth'
import { recordSubscribeCore, IngestValidationError } from '@/lib/site/ingest-core'

// 官网 /api/subscribe 的持久化后端。
//
// 返回 `outcome` 三态而不是一个光秃秃的 success,是为了让官网能逐字还原它原本的行为:
//   created        → 发欢迎信(只有真正插入的那一方发 → 并发下不会重复发信)
//   reactivated    → 不发信
//   already_active → 官网回 409「该邮箱已订阅」
// 把这个判别式压成布尔值，上面三条里有两条会悄悄失真。
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const denied = checkIngestSecret(req)
  if (denied) return denied

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ success: false, error: 'malformed JSON body' }, { status: 400 })
  }

  try {
    const outcome = await recordSubscribeCore(body)
    return Response.json({ success: true, data: { outcome } })
  } catch (e) {
    if (e instanceof IngestValidationError) {
      return Response.json({ success: false, error: e.message }, { status: 400 })
    }
    console.error('[api/site/subscribe] 写入失败', e)
    return Response.json({ success: false, error: 'internal error' }, { status: 500 })
  }
}
