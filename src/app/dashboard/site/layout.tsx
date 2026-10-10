import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { getAuthContext } from '@/auth/context'
import SiteTabs from './site-tabs'

// 官网(ithacateens.com)运营控制台。从官网仓的 SvelteKit /admin 移植。
//
// 这里是**页面级**的快速弹出门:非超管直接回 /dashboard。真正的安全边界在每个 core 的
// requireSiteAdmin()——手搓一个 Server Action 请求不会经过这个 layout。两道都要有:
// 这一道给人看(别让普通管理员看到一个点进去全是 403 的菜单),那一道挡机器。
//
// 用 getAuthContext() 而不是 requireAuthContext():未登录时该走 /login(由 proxy.ts 的
// /dashboard/* 守卫兜),而不是抛一个会撞上错误边界的 AuthError。
export default async function SiteAdminLayout({ children }: { children: ReactNode }) {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!ctx.isPlatformAdmin) redirect('/dashboard')

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h2 className="text-lg font-semibold">官网运营</h2>
        <p className="text-xs text-neutral-500">
          ithacateens.com 的询盘、订阅者、邮件群发与站内弹窗 · 仅超级管理员可见
        </p>
      </div>
      <SiteTabs />
      {children}
    </section>
  )
}
