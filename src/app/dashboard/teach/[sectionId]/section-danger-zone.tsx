'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cancelSeriesAction } from '@/app/dashboard/schedule/actions'
import InlineConfirm from '@/app/dashboard/_components/inline-confirm'
import { useFlash } from '@/app/dashboard/_components/use-flash'

export default function SectionDangerZone({ sectionId }: { sectionId: string }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const { flash, show } = useFlash()

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
              const res = await cancelSeriesAction(sectionId)
              show(`已取消 ${res.canceled} 节课`)
              router.refresh()
            })
          }
        />
        {flash && (
          <span aria-live="polite" className="text-xs text-green-700">
            {flash}
          </span>
        )}
      </div>
    </div>
  )
}
