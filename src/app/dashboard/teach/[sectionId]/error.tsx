'use client'

// Panel-level reset boundary: catches throws from page.tsx (the tab panels). Header/tab bar (in this
// segment's layout) stay put; only the panel area resets.
export default function SectionTabError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="rounded-lg border border-neutral-200 p-6 text-center shadow-sm">
      <p className="text-sm text-neutral-600">该内容加载失败，请重试。</p>
      <button
        type="button"
        onClick={reset}
        className="mt-3 rounded bg-neutral-900 px-3 py-1 text-xs text-white hover:bg-neutral-800"
      >
        重试
      </button>
    </div>
  )
}
