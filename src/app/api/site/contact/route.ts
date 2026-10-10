import { checkIngestSecret } from '@/lib/site/ingest-auth'
import { recordContactCore, IngestValidationError } from '@/lib/site/ingest-core'

// 官网 /api/contact 的持久化后端。官网保留它自己的来源校验、CSRF、限流、Turnstile 和双语
// 确认信 —— 只有两次数据库写入搬到了这里。
//
// nodejs runtime 是必需的(postgres.js 的 socket 和 server-only 模块不能跑在 edge)。
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const denied = checkIngestSecret(req)
  if (denied) return denied

  let body: unknown
  try {
    body = await req.json()
  } catch {
    // 畸形 JSON 走和校验失败同一个出口(400)，而不是冒泡成 500。
    return Response.json({ success: false, error: 'malformed JSON body' }, { status: 400 })
  }

  try {
    await recordContactCore(body)
    return Response.json({ success: true })
  } catch (e) {
    // 400:官网传来的数据不合规 —— 这是集成 bug，消息要能帮对面定位(它只进官网日志，
    // 不会转发给访客)。
    if (e instanceof IngestValidationError) {
      return Response.json({ success: false, error: e.message }, { status: 400 })
    }
    // 500:本项目这边的故障。官网必须据此**明确失败**而不是假装成功 —— 悄悄丢掉一条询盘
    // 比报错糟得多(这是选 B 架构时就接受的代价:官网表单硬依赖本项目在线)。
    // 内部错误消息不外传(CWE-209),只留在本项目日志里。
    console.error('[api/site/contact] 写入失败', e)
    return Response.json({ success: false, error: 'internal error' }, { status: 500 })
  }
}
