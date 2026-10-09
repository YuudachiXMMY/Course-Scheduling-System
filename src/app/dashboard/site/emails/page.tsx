import { listCampaignsCore } from '@/lib/site/campaigns-core'
import { countActiveSubscribersCore } from '@/lib/site/admin-core'
import { requireSiteAdmin } from '@/lib/site/authz'
import { isMailConfigured } from '@/lib/mail'
import CampaignsPanel from './campaigns-panel'

// 邮件群发。
//
// mailConfigured 从服务端读出来传给客户端:未配置 SMTP 时发送按钮直接禁用并给出说明,
// 而不是让人点下去再吃一个「服务器未配置邮件发送」。core 那边仍然会硬失败(那是安全边界),
// 这里只是不把人引到会被拒的路上。
export default async function SiteEmailsPage() {
  // 会话只解析一次，两个 core 共用这一个 ctx(否则一个页面要查两遍 session + member)。
  const ctx = await requireSiteAdmin()
  const [campaigns, activeSubscribers] = await Promise.all([
    listCampaignsCore(ctx),
    countActiveSubscribersCore(ctx),
  ])

  return (
    <CampaignsPanel
      campaigns={campaigns}
      activeSubscribers={activeSubscribers}
      mailConfigured={isMailConfigured}
    />
  )
}
