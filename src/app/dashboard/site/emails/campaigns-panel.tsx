'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { formatDateTime } from '@/lib/format-datetime'
import { campaignStatusLabel } from '@/lib/site/labels'
import { createCampaign, deleteCampaign, sendCampaign } from '../actions'

export interface CampaignView {
  id: string
  subject: string
  body: string
  status: string
  recipientCount: number
  sentAt: Date | null
  createdAt: Date
}

const STATUS_CLASS: Record<string, string> = {
  draft: 'bg-neutral-100 text-neutral-600',
  sending: 'bg-blue-50 text-blue-700',
  sent: 'bg-green-50 text-green-700',
  failed: 'bg-red-50 text-red-700',
}

export default function CampaignsPanel({
  campaigns,
  activeSubscribers,
  mailConfigured,
}: {
  campaigns: CampaignView[]
  activeSubscribers: number
  mailConfigured: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const router = useRouter()

  // 三个操作的收尾完全一样(清提示 → 跑 action → 失败内联报错 → 成功刷新)，抽成一个
  // 跑器。注意 catch:action 本身永不抛，但网络层会 —— 不接住的话 transition 里的拒绝
  // 会被上抛到错误边界，整页变成通用错误屏。
  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    setMsg(null)
    setError(null)
    startTransition(async () => {
      try {
        const res = await fn()
        if (!res.ok) {
          setError(res.error)
          return
        }
        setMsg(success)
        router.refresh()
      } catch {
        setError('操作失败，请稍后重试')
      }
    })
  }

  function create(e: React.FormEvent) {
    e.preventDefault()
    run(async () => {
      const res = await createCampaign({ subject, body })
      if (res.ok) {
        setSubject('')
        setBody('')
      }
      return res
    }, '已创建草稿')
  }

  function send(c: CampaignView) {
    // 不可撤销的对外动作 —— 确认框必须报出"发给多少人"和主题，否则等于没有确认。
    // 已发送过的重发只补发未送达的部分(投递台账保证),文案要把这件事说清楚。
    const retry = c.status === 'failed'
    const prompt = retry
      ? `重试发送「${c.subject}」？\n\n只会补发此前未送达的收件人（已送达的不会重复收到）。`
      : `确定发送「${c.subject}」？\n\n将发给当前 ${activeSubscribers} 位订阅中的订阅者。此操作不可撤销。`
    if (!window.confirm(prompt)) return

    setMsg(null)
    setError(null)
    startTransition(async () => {
      try {
        const res = await sendCampaign(c.id)
        if (!res.ok) {
          setError(res.error)
          router.refresh() // 失败时状态已变为 failed,列表要跟上
          return
        }
        setMsg(`已发送，实际送达 ${res.recipientCount} 人`)
        router.refresh()
      } catch {
        setError('发送失败，请稍后重试')
        router.refresh()
      }
    })
  }

  function remove(c: CampaignView) {
    if (!window.confirm(`确定删除「${c.subject}」？该操作不可撤销。`)) return
    run(() => deleteCampaign(c.id), '已删除')
  }

  return (
    <div className="flex flex-col gap-6">
      {!mailConfigured && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          服务器未配置邮件发送（SMTP），当前只能创建和编辑草稿，发送会被拒绝。 配置 SMTP_HOST /
          SMTP_USER / SMTP_PASSWORD 后即可群发。
        </p>
      )}

      <form
        onSubmit={create}
        className="flex flex-col gap-3 rounded-xl border border-neutral-200 p-5"
      >
        <h3 className="text-sm font-medium text-neutral-700">新建邮件</h3>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-600">主题</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
            maxLength={300}
            className="rounded-lg border border-neutral-200 px-3 py-2"
            placeholder="例如：秋季营地报名开放"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-600">正文（HTML）</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            rows={8}
            className="rounded-lg border border-neutral-200 px-3 py-2 font-mono text-xs"
            placeholder="<p>各位家长好……</p>"
          />
          {/* 正文按 HTML 原样发出(官网原版即如此)。这里不做净化:作者是超级管理员本人,
              收件人是订阅者的邮件客户端 —— 邮件客户端本身会剥掉脚本。但要提醒一句,
              免得有人把不受信任的内容粘进来。 */}
          <span className="text-xs text-neutral-500">
            正文按 HTML 原样发送。请勿粘贴来源不可信的内容。
          </span>
        </label>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending || !subject.trim() || !body.trim()}
            className="self-start rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {pending ? '处理中…' : '保存为草稿'}
          </button>
          <span className="text-xs text-neutral-500 tabular-nums">
            当前订阅中：{activeSubscribers} 人
          </span>
        </div>
      </form>

      {(msg || error) && (
        <p className={error ? 'text-sm text-red-600' : 'text-sm text-green-700'}>{error ?? msg}</p>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-neutral-700 tabular-nums">
          邮件（{campaigns.length}）
        </h3>
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
          {campaigns.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-neutral-500">暂无邮件</li>
          )}
          {campaigns.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{c.subject}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLASS[c.status] ?? 'bg-neutral-100 text-neutral-600'}`}
                  >
                    {campaignStatusLabel(c.status)}
                  </span>
                </div>
                <p className="text-xs text-neutral-500 tabular-nums">
                  创建于 {formatDateTime(c.createdAt)}
                  {c.status === 'sent' && ` · 送达 ${c.recipientCount} 人`}
                  {c.sentAt && ` · 发送于 ${formatDateTime(c.sentAt)}`}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {/* 发送中不给任何按钮:删除会级联带走投递台账(那是"谁已收到"的唯一记录),
                    重复发送则由 core 的原子抢占挡住 —— 但不该让 UI 把人引到会被拒的路上。 */}
                {c.status !== 'sending' && c.status !== 'sent' && (
                  <button
                    type="button"
                    onClick={() => send(c)}
                    disabled={pending || !mailConfigured}
                    className="rounded-lg bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50"
                  >
                    {c.status === 'failed' ? '重试发送' : '发送'}
                  </button>
                )}
                {c.status !== 'sending' && (
                  <button
                    type="button"
                    onClick={() => remove(c)}
                    disabled={pending}
                    className="text-sm text-red-600 hover:underline disabled:opacity-50"
                  >
                    删除
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
