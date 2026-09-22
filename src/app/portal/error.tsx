'use client'

import { useEffect } from 'react'

// H10: route-segment error boundary for the family portal. Without it, ANY error thrown while
// rendering a portal Server Component (a transient DB blip, a slow query) bubbles past the portal
// layout to the root global-error boundary, which REPLACES the entire document — the least technical
// users (parents/students on mobile) lose the whole app shell. This contains the failure to the
// content area and offers an in-place recovery instead.
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <section className="flex flex-col items-start gap-4 rounded-lg border border-red-200 bg-red-50 p-6 shadow-sm">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-red-800">内容加载出错</h2>
        <p className="text-sm text-red-700">
          页面暂时无法加载。请点击重试；若反复出现，请稍后再试。
        </p>
        {error.digest && <p className="mt-1 text-xs text-red-500">错误编号：{error.digest}</p>}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800"
        >
          重试
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          刷新页面
        </button>
      </div>
    </section>
  )
}
