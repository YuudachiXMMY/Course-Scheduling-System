'use client'

// H3: one-time cross-border AI processing notice shown before the first report draft in an org that
// has not yet acknowledged. Presentational only — the parent panel wires the acknowledge action and
// re-runs the draft on confirm, so both the reports page and the section workspace share one notice.
export function CrossBorderAckNotice({
  onConfirm,
  pending,
}: {
  onConfirm: () => void
  pending: boolean
}) {
  return (
    <div
      role="alertdialog"
      aria-label="跨境 AI 处理告知"
      className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm"
    >
      <p className="font-medium text-amber-900">首次使用 AI 起草报告</p>
      <p className="text-amber-800">
        生成报告草稿会将该学生的课程数据（出勤、成绩、已开放的课堂笔记）发送至境外 AI
        服务处理，用于起草叙述文字。学生姓名在发送前已脱敏；出勤率与成绩等数字始终由本系统在本地渲染，
        AI 不参与计算。请确认您（代表本机构）知悉此跨境处理后再继续。
      </p>
      <div>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="rounded bg-amber-700 px-3 py-1.5 text-sm text-white hover:bg-amber-800 disabled:opacity-50"
        >
          {pending ? '处理中…' : '确认知悉并继续'}
        </button>
      </div>
    </div>
  )
}
