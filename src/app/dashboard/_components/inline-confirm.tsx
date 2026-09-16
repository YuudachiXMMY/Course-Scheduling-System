'use client'

import { useState } from 'react'

/*
 * Two-step inline confirmation. First click "arms" the control, swapping it in place for
 * 确定 / 取消 — no native window.confirm (which is jarring, unstyled, and blocks the whole
 * browser event loop, breaking the Chrome-extension automation used in dev). Reserved for
 * NEW / workspace-only affordances: never wire this onto a control an existing e2e spec
 * clicks once and asserts on immediately (it would turn a one-click flow into two).
 */
export default function InlineConfirm({
  label,
  confirmLabel = '确定',
  onConfirm,
  danger = false,
  disabled = false,
  className = '',
  'data-testid': testId,
}: {
  label: string
  confirmLabel?: string
  onConfirm: () => void
  danger?: boolean
  disabled?: boolean
  className?: string
  'data-testid'?: string
}) {
  const [armed, setArmed] = useState(false)

  const base =
    'rounded px-3 py-1 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
  const idle = danger
    ? 'border border-red-300 text-red-600 hover:bg-red-50'
    : 'border border-neutral-300 text-neutral-700 hover:bg-neutral-50'

  if (!armed) {
    return (
      <button
        type="button"
        disabled={disabled}
        data-testid={testId}
        className={`${base} ${idle} ${className}`}
        onClick={() => setArmed(true)}
      >
        {label}
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        autoFocus
        disabled={disabled}
        data-testid={testId ? `${testId}-confirm` : undefined}
        className={`${base} ${
          danger
            ? 'bg-red-600 text-white hover:bg-red-700'
            : 'bg-neutral-900 text-white hover:bg-neutral-800'
        }`}
        onClick={() => {
          setArmed(false)
          onConfirm()
        }}
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        className={`${base} border border-neutral-300 text-neutral-500 hover:bg-neutral-50`}
        onClick={() => setArmed(false)}
      >
        取消
      </button>
    </span>
  )
}
