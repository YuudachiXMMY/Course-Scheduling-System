import { requireAuthContext } from '@/auth/context'
import { can } from '@/auth/authorize'
import { env } from '@/env'
import { getActiveSectionShare } from '../section-share-data'
import SectionSharePanel from '../section-share-panel'

// 导出 tab: the two heavy ZIP GET routes as stable-URL links (never inlined). Each is hidden if its
// permission is absent. The report ZIP endpoint previously had no UI entry point. 功能2 adds the
// per-section public share link panel below.
export default async function ExportPanel({ sectionId }: { sectionId: string }) {
  const ctx = await requireAuthContext()
  const canExportSchedule =
    can(ctx.role, { student: ['read'] }) && can(ctx.role, { lesson: ['read'] })
  const canExportReports = can(ctx.role, { report: ['read'] })
  const canShare = can(ctx.role, { lesson: ['read'] })
  const share = canShare ? await getActiveSectionShare(ctx, sectionId) : null
  const linkClass =
    'rounded border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50'

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-neutral-500">按班级批量导出课表或已定稿报告（ZIP）。</p>
      <div className="flex flex-wrap gap-3">
        {canExportSchedule && (
          <a href={`/api/export/section/${sectionId}`} className={linkClass}>
            批量导出课表(ZIP)
          </a>
        )}
        {canExportReports && (
          <a href={`/api/reports/section/${sectionId}`} className={linkClass}>
            批量导出报告(ZIP)
          </a>
        )}
      </div>
      {canExportReports && (
        <p className="text-xs text-neutral-400">报告仅导出已定稿的，未定稿的学生将跳过。</p>
      )}
      {!canExportSchedule && !canExportReports && (
        <p className="text-sm text-neutral-500">你没有导出权限。</p>
      )}
      {canShare && (
        <SectionSharePanel
          sectionId={sectionId}
          token={share?.token ?? null}
          shareOrigin={env.NEXT_PUBLIC_APP_URL}
        />
      )}
    </div>
  )
}
