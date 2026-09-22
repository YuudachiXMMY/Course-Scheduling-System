'use client'

import { useEffect } from 'react'

// H10: route-segment error boundary for the (auth) segment (login / signup). Without it, an error
// thrown while rendering these pages bubbles to the root global-error boundary and replaces the whole
// document — a jarring dead-end on the very first screen a user sees. This keeps a recoverable, on-brand
// fallback so a transient failure on the login page never looks like a total outage.
export default function AuthError({
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
        <h2 className="text-base font-semibold text-red-800">页面加载出错</h2>
        <p className="text-sm text-red-700">
          登录页暂时无法加载。请点击重试；若反复出现，请稍后再试。
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
