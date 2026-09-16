'use client'

// Catches errors thrown by the child [sectionId]/layout.tsx (e.g. getSectionHeader). Because an
// error.tsx renders INSIDE its own segment's layout, this renders within teach/layout.tsx — the rail
// is preserved and only the main pane shows the error card. A [sectionId]/error.tsx cannot catch its
// own layout's throws (they bubble to the parent), which is exactly why this file exists.
export default function TeachError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="rounded-lg border border-neutral-200 p-6 text-center shadow-sm">
      <p className="text-sm text-neutral-600">加载失败，请重试。</p>
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
