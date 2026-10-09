import { listPopupsCore } from '@/lib/site/admin-core'
import { requireSiteAdmin } from '@/lib/site/authz'
import { isPopupLive } from '@/lib/site/popup-active'
import PopupsPanel from './popups-panel'

// 站内弹窗。
//
// 一条需要让运营方知道的事:从这里改弹窗之后，官网最多还会继续显示旧内容 **60 秒**。
// 原因是官网侧有一个进程内 TTL 缓存(每个实例每 60 秒最多读一次库)。在官网自己的 /admin 里
// 改弹窗会同步调 invalidatePopupCache() 立即失效;移植到本项目后那个函数在另一个进程里,
// 调不到了 —— 所以陈旧窗口从"立即"变成"≤60 秒"。这是本次移植唯一的行为回退，已在界面上说明。
export default async function SitePopupsPage() {
  const rows = await listPopupsCore(await requireSiteAdmin())
  // "官网此刻正在显示哪一条"在服务端算好 —— 判定逻辑只有 isPopupLive 一份(已被测试钉住),
  // 客户端也就不必在渲染期读当前时间(那是不纯的)。单一 now 保证同一次渲染里判定自洽。
  const now = new Date()
  const popups = rows.map((p) => ({ ...p, live: isPopupLive(p, now) }))
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-xs text-neutral-600">
        弹窗改动最多 60 秒后在官网生效（官网侧有 60 秒缓存）。
      </p>
      <PopupsPanel popups={popups} />
    </div>
  )
}
