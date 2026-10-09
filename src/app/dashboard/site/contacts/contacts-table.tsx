'use client'

import { Fragment, useState, type ReactNode } from 'react'
import { formatDateTime } from '@/lib/format-datetime'
import { contactLocaleLabel, contactTopicLabel, contactStatusLabel } from '@/lib/site/labels'

// 询盘收件箱的表格:一行一条摘要，点击行展开显示全部字段。
//
// 为什么要展开而不是把列加宽:资格字段有八个(语言/年级/意向项目/咨询主题/来源/状态/备注/留言
// 全文),全摊成列会让表格横向滚动、每一列都窄到读不了。列表负责"扫",展开区负责"读"。
//
// 本组件自己声明 ContactView，而不是从 admin-core 引 ContactRow:那个模块是 'server-only',
// 哪怕只引类型，后续有人手滑去掉 `type` 关键字就会把服务端模块拖进客户端 bundle(项目里
// B2 踩过这个坑)。Date 可以跨 Server→Client 边界(RSC 的 "$D" 编码),所以时间字段原样传。

export interface ContactView {
  id: string
  name: string
  email: string
  phone: string | null
  message: string | null
  subscribe: boolean
  createdAt: Date
  locale: string | null
  grade: number | null
  programs: string[]
  topic: string | null
  source: string | null
  status: string
  notes: string | null
}

// 展开区里的一格。label 窄、值可换行 —— 留言和备注可能很长。
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="break-words whitespace-pre-wrap text-neutral-800">{children}</dd>
    </div>
  )
}

function ContactDetail({ c }: { c: ContactView }) {
  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Field label="状态">{contactStatusLabel(c.status)}</Field>
      <Field label="语言">{contactLocaleLabel(c.locale)}</Field>
      <Field label="年级">{c.grade === null ? '—' : `${c.grade} 年级`}</Field>
      <Field label="咨询主题">{contactTopicLabel(c.topic)}</Field>
      <Field label="电话">
        {c.phone ? (
          <a href={`tel:${c.phone}`} className="hover:underline">
            {c.phone}
          </a>
        ) : (
          '—'
        )}
      </Field>
      <Field label="来源">{c.source ?? '—'}</Field>
      <Field label="订阅邮件">{c.subscribe ? '是' : '否'}</Field>
      <Field label="提交时间">
        <span className="tabular-nums">{formatDateTime(c.createdAt)}</span>
      </Field>

      <div className="col-span-2 sm:col-span-4">
        <Field label="意向项目">
          {c.programs.length === 0 ? (
            '—'
          ) : (
            // 项目 slug 原样显示。不在本项目维护一份 slug→中文名的映射:那份目录住在官网仓
            // (src/lib/content/programs.ts),复制过来必然在官网上新项目时静默过期,
            // 显示一个过期的中文名比显示一个自解释的英文 slug 更糟。
            <span className="flex flex-wrap gap-1">
              {c.programs.map((p) => (
                <span
                  key={p}
                  className="rounded bg-neutral-200 px-1.5 py-0.5 font-mono text-xs text-neutral-700"
                >
                  {p}
                </span>
              ))}
            </span>
          )}
        </Field>
      </div>

      <div className="col-span-2 sm:col-span-4">
        <Field label="留言">{c.message ?? '—'}</Field>
      </div>

      {/* 内部分诊备注。目前只读 —— 编辑状态/备注是另一笔(三态分诊),见 PR 描述。 */}
      <div className="col-span-2 sm:col-span-4">
        <Field label="内部备注">{c.notes ?? '—'}</Field>
      </div>
    </dl>
  )
}

export default function ContactsTable({ contacts }: { contacts: ContactView[] }) {
  // 用 Set 而不是单个 openId:收件箱的用法是逐条读下去、还要回头对比，所以允许同时展开多条。
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
          <tr>
            <th className="px-4 py-2 font-medium">姓名</th>
            <th className="px-4 py-2 font-medium">邮箱</th>
            <th className="px-4 py-2 font-medium">电话</th>
            <th className="px-4 py-2 font-medium">留言</th>
            <th className="px-4 py-2 font-medium">订阅</th>
            <th className="px-4 py-2 font-medium">提交时间</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {contacts.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-neutral-500">
                暂无询盘
              </td>
            </tr>
          )}
          {contacts.map((c) => {
            const isOpen = open.has(c.id)
            const detailId = `contact-detail-${c.id}`
            return (
              <Fragment key={c.id}>
                <tr
                  // 整行可点。行内那个 <button> 不自己接 onClick —— 点击(含键盘 Enter/Space 触发的
                  // click)会冒泡到这里，所以只会切换一次，而不是切两次切回去。
                  onClick={() => toggle(c.id)}
                  className={`cursor-pointer align-top ${isOpen ? 'bg-neutral-50' : 'hover:bg-neutral-50'}`}
                >
                  <td className="px-4 py-2 whitespace-nowrap">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={detailId}
                      className="flex items-center gap-1.5 text-left font-medium text-neutral-800"
                    >
                      <span aria-hidden className="text-xs text-neutral-400">
                        {isOpen ? '▾' : '▸'}
                      </span>
                      {c.name}
                    </button>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {/* mailto 不能同时触发展开 —— 点邮箱是"写信"，不是"看详情"。 */}
                    <a
                      href={`mailto:${c.email}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-neutral-700 hover:underline"
                    >
                      {c.email}
                    </a>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{c.phone ?? '—'}</td>
                  {/* 留言在列表里只留一行预览;全文在展开区(whitespace-pre-wrap 保留换行)。 */}
                  <td className="max-w-xs truncate px-4 py-2 text-neutral-600">
                    {c.message ?? '—'}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{c.subscribe ? '是' : '否'}</td>
                  <td className="px-4 py-2 whitespace-nowrap tabular-nums">
                    {formatDateTime(c.createdAt)}
                  </td>
                </tr>
                {isOpen && (
                  <tr id={detailId} className="bg-neutral-50">
                    <td colSpan={6} className="border-t border-neutral-200 px-4 py-3">
                      <ContactDetail c={c} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
