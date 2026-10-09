'use server'

import { revalidatePath } from 'next/cache'
import { toPortalActionError } from '@/lib/errors'
import { requireSiteAdmin } from '@/lib/site/authz'
import {
  deleteSubscriberCore,
  createPopupCore,
  updatePopupCore,
  deletePopupCore,
  exportContactsCore,
  exportSubscribersCore,
  type ContactRow,
  type SubscriberRow,
} from '@/lib/site/admin-core'
import { createCampaignCore, deleteCampaignCore, sendCampaignCore } from '@/lib/site/campaigns-core'

// 官网控制台的 Server Action。
//
// 两条贯穿全文件的约定:
//
// 1) **永不抛给调用方**，一律返回 { ok } 判别式。Next 16 / React 19 会把 transition 里的未处理
//    拒绝上抛到最近的错误边界，整个面板被通用错误屏替换(项目里 B7 踩过)。返回结构化结果,
//    客户端就能内联显示错误而不丢失页面状态。
//
// 2) 错误转译复用 toPortalActionError。名字里的 "portal" 指它最初的使用场景，但它的行为正是
//    这里需要的:BusinessError → 原文(构造上即安全)、AuthError → 中文、其余一律收敛成兜底文案
//    并只记服务端日志(CWE-209,内部错误消息绝不外传)。与其 fork 一份近乎一样的逻辑,
//    不如复用这一份 —— 两边对"什么消息可以外传"的判断必须始终一致。
//
// 3) 授权在入口解析一次(requireSiteAdmin()),再把 ctx 传给 core;core 的第一行仍会
//    assertSiteAdmin(ctx) 再断言一次(纵深防御)。会话只解析一次，而不是每个 core 一次。

type ActionResult = { ok: true } | { ok: false; error: string }

// 控制台所有列表都在 /dashboard/site/* 下。逐条 revalidate 具体子路径没有意义(删一个订阅者
// 同时改变了订阅者列表和概览的统计数字),所以统一刷整棵子树。
function revalidateSite(): void {
  revalidatePath('/dashboard/site', 'layout')
}

// ── 订阅者 ──────────────────────────────────────────────────────────────────────────────────
export async function deleteSubscriber(id: string): Promise<ActionResult> {
  try {
    await deleteSubscriberCore(await requireSiteAdmin(), id)
    revalidateSite()
    return { ok: true }
  } catch (e) {
    return toPortalActionError(e, '删除订阅者失败')
  }
}

// ── 弹窗 ────────────────────────────────────────────────────────────────────────────────────
export async function createPopup(input: unknown): Promise<ActionResult> {
  try {
    await createPopupCore(await requireSiteAdmin(), input)
    revalidateSite()
    return { ok: true }
  } catch (e) {
    return toPortalActionError(e, '创建弹窗失败')
  }
}

export async function updatePopup(input: unknown): Promise<ActionResult> {
  try {
    await updatePopupCore(await requireSiteAdmin(), input)
    revalidateSite()
    return { ok: true }
  } catch (e) {
    return toPortalActionError(e, '保存弹窗失败')
  }
}

export async function deletePopup(id: string): Promise<ActionResult> {
  try {
    await deletePopupCore(await requireSiteAdmin(), id)
    revalidateSite()
    return { ok: true }
  } catch (e) {
    return toPortalActionError(e, '删除弹窗失败')
  }
}

// ── 邮件群发 ────────────────────────────────────────────────────────────────────────────────
export async function createCampaign(input: unknown): Promise<ActionResult> {
  try {
    await createCampaignCore(await requireSiteAdmin(), input)
    revalidateSite()
    return { ok: true }
  } catch (e) {
    return toPortalActionError(e, '创建邮件失败')
  }
}

export async function deleteCampaign(id: string): Promise<ActionResult> {
  try {
    await deleteCampaignCore(await requireSiteAdmin(), id)
    revalidateSite()
    return { ok: true }
  } catch (e) {
    return toPortalActionError(e, '删除邮件失败')
  }
}

// 群发。成功时带回实际送达人数 —— 这个数字是运营方唯一能据以判断"这封信到底发出去了多少"
// 的凭据，不能只回一个 ok。
export async function sendCampaign(
  id: string,
): Promise<{ ok: true; recipientCount: number } | { ok: false; error: string }> {
  try {
    const { recipientCount } = await sendCampaignCore(await requireSiteAdmin(), id)
    revalidateSite()
    return { ok: true, recipientCount }
  } catch (e) {
    // 失败分支也要 revalidate:core 已经把 campaign 状态翻成了 'failed',列表必须跟上,
    // 否则运营方看到的还是"草稿"，会以为自己没点到。
    revalidateSite()
    return toPortalActionError(e, '发送失败')
  }
}

// ── CSV 导出 ────────────────────────────────────────────────────────────────────────────────
// 导出走 action 而不是在首屏把全表塞进客户端 bundle:列表页只渲染当前一页，点了导出才去取全量。
//
// 与官网版的一处有意差异:官网的导出按钮只导出**当前页**(它从前端已加载的数组里取数),
// 点一次拿到 20 行。那是个陷阱而不是需求 —— 运营方点"导出"是要拿全量去外部处理。
// 这里导出全表，并由 core 的 EXPORT_MAX_ROWS 兜住内存:超限时明确报错，绝不静默截断。
export async function exportContacts(): Promise<
  { ok: true; rows: ContactRow[] } | { ok: false; error: string }
> {
  try {
    return { ok: true, rows: await exportContactsCore(await requireSiteAdmin()) }
  } catch (e) {
    return toPortalActionError(e, '导出询盘失败')
  }
}

export async function exportSubscribers(): Promise<
  { ok: true; rows: SubscriberRow[] } | { ok: false; error: string }
> {
  try {
    return { ok: true, rows: await exportSubscribersCore(await requireSiteAdmin()) }
  } catch (e) {
    return toPortalActionError(e, '导出订阅者失败')
  }
}
