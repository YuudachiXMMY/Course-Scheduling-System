import Link from 'next/link'
import { requireAuthContext } from '@/auth/context'
import { requirePermission, can } from '@/auth/authorize'
import { getReportsPageData } from './data'
import ReportPanel from './report-panel'

export default async function ReportsPage() {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { report: ['list'] })
  // B16: list 权限不等于 update/approve 权限。仅 report:update 者可写；否则整个面板只读（助教等
  // 只有 report:list 的角色看到锁定的报告，编辑/批准 UI 不渲染）。平台管理员与 requirePermission 一致地放行。
  const canWrite = ctx.isPlatformAdmin || can(ctx.role, { report: ['update'] })
  const { reports, students } = await getReportsPageData(ctx)

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">进度报告</h2>
      <Link
        href="/dashboard/teach"
        className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600 hover:bg-neutral-100"
      >
        <span>可在「教务工作台」内按班级选择学生并生成报告（默认本月，可选自定义区间）。</span>
        <span className="shrink-0 font-medium text-neutral-900">前往教务工作台 →</span>
      </Link>
      <ReportPanel students={students} reports={reports} readOnly={!canWrite} />
    </section>
  )
}
