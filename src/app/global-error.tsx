'use client'

import { useEffect } from 'react'

// Top-level fallback for errors thrown in the ROOT layout or outside any nested error boundary.
// A global-error must render its own <html>/<body> because it replaces the root layout entirely.
// Like the dashboard boundary, it turns Next's opaque "This page couldn't load" / React #441 into a
// clear, recoverable screen.
export default function GlobalError({
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
    <html lang="zh-CN">
      <body
        style={{
          fontFamily: "system-ui, 'Noto Sans SC', sans-serif",
          display: 'flex',
          minHeight: '100dvh',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          margin: 0,
          background: '#fafafa',
          color: '#171717',
        }}
      >
        <div style={{ maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>页面加载出错</h2>
          <p style={{ fontSize: 14, color: '#525252', margin: 0 }}>
            应用遇到未预期的错误。请重试；若反复出现，请刷新页面或稍后再试。
          </p>
          {error.digest && (
            <p style={{ fontSize: 12, color: '#a3a3a3', margin: 0 }}>错误编号：{error.digest}</p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              alignSelf: 'flex-start',
              borderRadius: 6,
              background: '#171717',
              color: '#fff',
              padding: '6px 12px',
              fontSize: 14,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            重试
          </button>
        </div>
      </body>
    </html>
  )
}
