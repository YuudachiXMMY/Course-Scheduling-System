'use client'

import { useEffect } from 'react'

// Route-segment error boundary for the whole dashboard. Without it, ANY thrown error during a
// Server Component render or a Server Action (e.g. a missing ANTHROPIC_API_KEY while drafting a
// report, or a transient DB failure while editing a course) surfaces as Next's cryptic fallbacks —
// "This page couldn't load. Reload to try again, or go back." on a failed RSC navigation, or the
// redacted "Minified React error #441" (Server Components render error) in production. This renders
// a friendly, RECOVERABLE screen instead: reset() re-renders the segment without a full reload.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Surface the real error in the server/client logs for debugging (the UI stays generic).
    console.error(error)
  }, [error])

  return (
    <section className="flex flex-col items-start gap-4 rounded border border-red-200 bg-red-50 p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-red-800">页面加载出错</h2>
        <p className="text-sm text-red-700">
          操作未能完成。请重试；若反复出现，请刷新页面或稍后再试。
        </p>
        {error.digest && <p className="mt-1 text-xs text-red-500">错误编号：{error.digest}</p>}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white"
        >
          重试
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700"
        >
          刷新页面
        </button>
      </div>
    </section>
  )
}
