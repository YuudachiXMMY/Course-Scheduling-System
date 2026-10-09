'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { DateTime } from 'luxon'
import { APP_TIME_ZONE } from '@/lib/timezone'
import { formatDateTime } from '@/lib/format-datetime'
import { createPopup, updatePopup, deletePopup } from '../actions'

export interface PopupView {
  id: string
  title: string
  content: string
  buttonText: string | null
  buttonLink: string | null
  isActive: boolean
  startDate: Date | null
  endDate: Date | null
  displayRules: string | null
  createdAt: Date
  // "官网此刻正在显示这一条"——由**服务端**用 isPopupLive() 算好传下来。
  // 不在渲染期算:那需要 Date.now(),而渲染期读当前时间是不纯的(react-hooks/purity),
  // 会让徽章随无关重渲染漂移。判定逻辑也因此只有一份(tests/site-pure.test.ts 钉住它)。
  live: boolean
}

// <input type="datetime-local"> 要的是**无时区**的本地挂钟串。库里存 UTC,所以渲染时要
// 转成 APP_TIME_ZONE 的挂钟、提交时再转回带时区的 ISO —— 这一来一回不能省，否则运营方
// 填的"晚上八点"会被当成 UTC 八点，在多伦多变成下午三四点。
function toLocalInput(d: Date | null): string {
  if (!d) return ''
  return DateTime.fromJSDate(d, { zone: 'utc' })
    .setZone(APP_TIME_ZONE)
    .toFormat("yyyy-MM-dd'T'HH:mm")
}

function fromLocalInput(v: string): string | null {
  if (!v) return null
  // 明确按 APP_TIME_ZONE 解读这个挂钟串，再输出带偏移的 ISO 交给 zod 的 datetime 校验。
  const dt = DateTime.fromISO(v, { zone: APP_TIME_ZONE })
  return dt.isValid ? dt.toISO() : null
}

type Draft = {
  id: string | null // null = 新建
  title: string
  content: string
  buttonText: string
  buttonLink: string
  isActive: boolean
  startDate: string
  endDate: string
  displayRules: string
}

const EMPTY: Draft = {
  id: null,
  title: '',
  content: '',
  buttonText: '',
  buttonLink: '',
  isActive: false,
  startDate: '',
  endDate: '',
  displayRules: '',
}

function toDraft(p: PopupView): Draft {
  return {
    id: p.id,
    title: p.title,
    content: p.content,
    buttonText: p.buttonText ?? '',
    buttonLink: p.buttonLink ?? '',
    isActive: p.isActive,
    startDate: toLocalInput(p.startDate),
    endDate: toLocalInput(p.endDate),
    displayRules: p.displayRules ?? '',
  }
}

export default function PopupsPanel({ popups }: { popups: PopupView[] }) {
  const [pending, startTransition] = useTransition()
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const editing = draft.id !== null

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    setError(null)

    // 两个日期都在客户端先校验一次:提交一个非法串只会换来一条服务端 400,不如就地拦住。
    const startDate = fromLocalInput(draft.startDate)
    const endDate = fromLocalInput(draft.endDate)
    if (draft.startDate && !startDate) {
      setError('开始时间格式不正确')
      return
    }
    if (draft.endDate && !endDate) {
      setError('结束时间格式不正确')
      return
    }
    // 结束早于开始 = 一个永不显示的弹窗。schema 层没有这条跨字段约束(官网原版也没有),
    // 但在表单里拦住它是对的:这种配置没有任何合理用途，只会让人以为弹窗坏了。
    if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
      setError('结束时间不能早于开始时间')
      return
    }

    const payload = {
      title: draft.title,
      content: draft.content,
      buttonText: draft.buttonText || null,
      buttonLink: draft.buttonLink || '',
      isActive: draft.isActive,
      startDate,
      endDate,
      displayRules: draft.displayRules || undefined,
    }

    startTransition(async () => {
      try {
        const res = editing
          ? await updatePopup({ ...payload, id: draft.id })
          : await createPopup(payload)
        if (!res.ok) {
          setError(res.error)
          return
        }
        setMsg(editing ? '已保存' : '已创建')
        setDraft(EMPTY)
        router.refresh()
      } catch {
        setError('保存失败，请稍后重试')
      }
    })
  }

  function remove(p: PopupView) {
    if (!window.confirm(`确定删除弹窗「${p.title}」？该操作不可撤销。`)) return
    setMsg(null)
    setError(null)
    startTransition(async () => {
      try {
        const res = await deletePopup(p.id)
        if (!res.ok) {
          setError(res.error)
          return
        }
        // 正在编辑的那条被删掉时，把表单重置回新建态 —— 否则再点保存会撞上「弹窗不存在」。
        if (draft.id === p.id) setDraft(EMPTY)
        setMsg('已删除')
        router.refresh()
      } catch {
        setError('删除失败，请稍后重试')
      }
    })
  }

  const field = 'rounded-lg border border-neutral-200 px-3 py-2'

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={submit}
        className="flex flex-col gap-3 rounded-xl border border-neutral-200 p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-neutral-700">
            {editing ? '编辑弹窗' : '新建弹窗'}
          </h3>
          {editing && (
            <button
              type="button"
              onClick={() => setDraft(EMPTY)}
              className="text-xs text-neutral-500 hover:underline"
            >
              取消编辑
            </button>
          )}
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-600">标题</span>
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            required
            maxLength={200}
            className={field}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-600">内容</span>
          <textarea
            value={draft.content}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            required
            rows={4}
            maxLength={5000}
            className={field}
          />
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-600">按钮文案（可空）</span>
            <input
              value={draft.buttonText}
              onChange={(e) => setDraft({ ...draft, buttonText: e.target.value })}
              maxLength={100}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-600">按钮链接（可空）</span>
            <input
              value={draft.buttonLink}
              onChange={(e) => setDraft({ ...draft, buttonLink: e.target.value })}
              placeholder="https://…"
              className={field}
            />
            {/* 这个值会进官网每个访客浏览器的 <a href>。服务端只放行 http(s)(javascript: /
                data: 是存储型 XSS),这里把规则明说出来，免得人填了 mailto: 再被拒。 */}
            <span className="text-xs text-neutral-500">只接受 http(s) 链接</span>
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-600">开始时间（可空 = 立即）</span>
            <input
              type="datetime-local"
              value={draft.startDate}
              onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-600">结束时间（可空 = 不过期）</span>
            <input
              type="datetime-local"
              value={draft.endDate}
              onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
              className={field}
            />
          </label>
        </div>
        <p className="text-xs text-neutral-500">时间按 {APP_TIME_ZONE} 解读</p>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-600">展示规则（JSON，可空）</span>
          <input
            value={draft.displayRules}
            onChange={(e) => setDraft({ ...draft, displayRules: e.target.value })}
            placeholder={'{"pages":[],"frequency":"once"}'}
            className={`${field} font-mono text-xs`}
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
          />
          <span className="text-neutral-700">启用</span>
          <span className="text-xs text-neutral-500">（官网同一时刻只显示最新一条生效的弹窗）</span>
        </label>

        <button
          type="submit"
          disabled={pending || !draft.title.trim() || !draft.content.trim()}
          className="self-start rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {pending ? '处理中…' : editing ? '保存' : '创建'}
        </button>
      </form>

      {(msg || error) && (
        <p className={error ? 'text-sm text-red-600' : 'text-sm text-green-700'}>{error ?? msg}</p>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-neutral-700 tabular-nums">
          弹窗（{popups.length}）
        </h3>
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
          {popups.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-neutral-500">暂无弹窗</li>
          )}
          {popups.map((p) => (
            <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{p.title}</span>
                  {p.live ? (
                    <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">
                      官网正在显示
                    </span>
                  ) : p.isActive ? (
                    // 启用了但不在时间窗内 —— 这个区分很重要:运营方点了"启用"却看不到弹窗时,
                    // 第一反应是以为坏了，而真相通常是时间窗没到或已过。
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                      已启用 · 不在时间窗内
                    </span>
                  ) : (
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                      未启用
                    </span>
                  )}
                </div>
                <p className="max-w-xl text-xs break-words whitespace-pre-wrap text-neutral-600">
                  {p.content}
                </p>
                <p className="text-xs text-neutral-500 tabular-nums">
                  {p.startDate || p.endDate
                    ? `${formatDateTime(p.startDate)} → ${formatDateTime(p.endDate)}`
                    : '无时间限制'}
                  {p.buttonText && ` · 按钮：${p.buttonText}`}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setDraft(toDraft(p))}
                  disabled={pending}
                  className="rounded-lg border border-neutral-200 px-3 py-1 text-sm hover:bg-neutral-50 disabled:opacity-50"
                >
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() => remove(p)}
                  disabled={pending}
                  className="text-sm text-red-600 hover:underline disabled:opacity-50"
                >
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
