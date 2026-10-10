'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// 官网控制台的 tab 行。官网原版是左侧深色侧边栏 + lucide 图标 + paraglide 多语言;这里改成
// 与 /dashboard/users 一致的胶囊 tab、浅色、纯中文 —— 把一个控制台移植进现有设计系统，
// 就该穿这边的衣服，而不是顺带引入 lucide-react 和一套 i18n 管道来复刻原来的样子。
const TABS: readonly { href: string; label: string; exact?: boolean }[] = [
  { href: '/dashboard/site', label: '概览', exact: true },
  { href: '/dashboard/site/contacts', label: '询盘' },
  { href: '/dashboard/site/subscribers', label: '订阅者' },
  { href: '/dashboard/site/emails', label: '邮件群发' },
  { href: '/dashboard/site/popups', label: '弹窗' },
]

export default function SiteTabs() {
  const pathname = usePathname()
  return (
    <nav className="flex flex-wrap gap-1 text-sm">
      {TABS.map((t) => {
        // 概览必须精确匹配 —— 否则它在每个子页面上都显示为选中(前缀匹配的经典陷阱)。
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href)
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={
              active
                ? 'rounded-full bg-neutral-900 px-3 py-1 text-white'
                : 'rounded-full px-3 py-1 text-neutral-600 hover:bg-neutral-100'
            }
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
