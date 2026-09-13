import { requireAuthContext } from '@/auth/context'

export default async function DashboardPage() {
  const ctx = await requireAuthContext()
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">仪表盘</h2>
      <p className="text-sm text-neutral-600">
        当前机构：<code className="rounded bg-neutral-100 px-1">{ctx.tenantId}</code>
      </p>
      <p className="text-sm text-neutral-600">
        角色：<code className="rounded bg-neutral-100 px-1">{ctx.role}</code>
      </p>
    </section>
  )
}
