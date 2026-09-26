'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cancelSeriesAction } from '@/app/dashboard/schedule/actions'
import { archiveSection } from '@/app/dashboard/courses/actions'
import InlineConfirm from '@/app/dashboard/_components/inline-confirm'
import { useFlash } from '@/app/dashboard/_components/use-flash'

export default function SectionDangerZone({ sectionId }: { sectionId: string }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const { flash, show } = useFlash()
  const [err, setErr] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-red-200 p-4">
      <h3 className="text-sm font-medium text-red-700">危险操作</h3>
      <p className="text-xs text-neutral-500">
        取消本班级全部未来课节；已上的课节与出勤记录会保留。
      </p>
      <div className="flex items-center gap-2">
        <InlineConfirm
          danger
          label="取消全部未来课节"
          confirmLabel="确认取消"
          disabled={pending}
          onConfirm={() =>
            startTransition(async () => {
              // F7: cancelSeriesAction is throw-style (requirePermission / ownership / expired session all
              // throw, not { ok, error }). Without this catch an unhandled rejection bubbles to error.tsx and
              // replaces the whole Settings tab — discarding unsaved CourseForm/SectionForm edits on the same
              // panel. Surface the message inline (red) instead, matching the sibling Export/Share/Report panels.
              setErr(null)
              try {
                const res = await cancelSeriesAction(sectionId)
                show(`已取消 ${res.canceled} 节课`)
                router.refresh()
              } catch (e) {
                setErr(e instanceof Error ? e.message : '取消失败')
              }
            })
          }
        />
        {flash && (
          <span aria-live="polite" className="text-xs text-green-700">
            {flash}
          </span>
        )}
        {err && (
          <span aria-live="polite" className="text-xs text-red-600">
            {err}
          </span>
        )}
      </div>

      <div className="mt-2 border-t border-red-100 pt-2">
        <p className="mb-2 text-xs text-neutral-500">
          归档本班级：从课程与班级列表中隐藏；课节、出勤与报告都会保留，可随时在侧栏「已归档班级」中恢复。
        </p>
        <div className="flex items-center gap-2">
          <InlineConfirm
            danger
            label="归档班级"
            confirmLabel="确认归档"
            disabled={pending}
            onConfirm={() =>
              startTransition(async () => {
                // archiveSection returns {ok,error} (production redacts thrown Server Action errors). On
                // success the section leaves the rail (listSections filters archived); the [sectionId]
                // route itself still renders (getSectionHeader uses findById, which keeps archived rows),
                // but navigate to the workspace root anyway so the user lands somewhere still in the rail.
                setErr(null)
                const res = await archiveSection(sectionId)
                if (!res.ok) {
                  setErr(res.error)
                  return
                }
                router.push('/dashboard/teach')
                router.refresh()
              })
            }
          />
        </div>
      </div>
    </div>
  )
}
