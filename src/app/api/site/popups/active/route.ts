import { checkIngestSecret } from '@/lib/site/ingest-auth'
import { getActivePopupCore } from '@/lib/site/ingest-core'

// 官网 /api/popups/active 的数据来源。
//
// ⚠️ 这条路径在官网**每个公开页面**的热路径上。官网侧有 60 秒进程内缓存兜着，所以本端点
// 的 QPS 约为"官网实例数 / 60 秒"——很低。官网那边的失败处理是软降级(供陈旧值，否则 null,
// 绝不抛),所以本项目短暂不可用不会把官网页面带下去;官网表单就没这个待遇了(硬失败)。
//
// 这里不加自己的缓存:数据源头就一个 60 秒 TTL 在官网侧，再叠一层只会让"运营方改了弹窗
// 多久能看到"变成两层 TTL 相加，难以解释。陈旧窗口只应该有一个,并且它在官网侧。
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const denied = checkIngestSecret(req)
  if (denied) return denied

  try {
    const activePopup = await getActivePopupCore()
    return Response.json({ success: true, data: activePopup })
  } catch (e) {
    console.error('[api/site/popups/active] 读取失败', e)
    return Response.json({ success: false, error: 'internal error' }, { status: 500 })
  }
}
