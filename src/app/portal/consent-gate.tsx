'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { acknowledgeConsent } from './consent-actions'

// First-login data-notice, presented as a small closable modal window (PIPEDA / Ontario).
// The portal content behind it is still server-gated by requireConsent, so the notice appears in its
// place until the user acts. Under PIPEDA meaningful-consent guidance we treat BOTH dismissal paths as
// consent: pressing "我已阅读并同意" and closing the window (× / Esc) both stamp portalLink.consentedAt
// (implied consent — the disclosure line discloses this) so the notice never reappears and the portal
// becomes usable. router.refresh() then swaps the notice for the page.
export default function ConsentGate() {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  // Mirrors the in-flight state for the once-bound keydown listener, whose stale closure can't read
  // `pending`. Guards the Esc path against key-repeat / rapid re-fire the way `disabled={pending}`
  // already guards the two buttons.
  const consentingRef = useRef(false)
  const headingId = 'consent-gate-title'
  const descId = 'consent-gate-desc'
  const disclosureId = 'consent-gate-disclosure'

  // Shared by the agree button, the × close, and Esc: all three are consent under our PIPEDA reading.
  function consent() {
    if (consentingRef.current) return // one-shot: ignore re-entrant calls while a submit is in flight
    consentingRef.current = true
    setError(null)
    startTransition(async () => {
      try {
        await acknowledgeConsent()
        router.refresh() // success → the gate unmounts as content takes its place; keep ref latched
      } catch (e) {
        consentingRef.current = false // failure → allow the user to retry
        setError(e instanceof Error ? e.message : '提交失败')
      }
    })
  }

  // Modal affordances: focus into the dialog on mount, Esc = implied consent, and a minimal focus trap
  // so Tab/Shift+Tab cannot reach the page chrome behind the backdrop (esp. the header's logout button)
  // while aria-modal is asserted.
  useEffect(() => {
    closeRef.current?.focus()
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        consent()
        return
      }
      if (e.key === 'Tab') {
        const root = dialogRef.current
        if (!root) return
        const focusables = Array.from(
          root.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        const active = document.activeElement
        if (e.shiftKey && (active === first || !root.contains(active))) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && (active === last || !root.contains(active))) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // consent/refs are stable for this one-shot notice; deps intentionally empty to bind once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    // Backdrop click is intentionally inert (no onClick): an accidental outside click must NOT count as
    // implied consent. Only the explicit × / Esc / agree gestures do.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={`${descId} ${disclosureId}`}
        className="relative flex w-full max-w-md flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-xl"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={consent}
          disabled={pending}
          aria-label="关闭（视为同意）"
          className="absolute top-3 right-3 rounded p-1 text-xl leading-none text-neutral-400 hover:text-neutral-700 disabled:opacity-50"
        >
          ×
        </button>

        <h2 id={headingId} className="pr-6 text-lg font-semibold">
          数据处理告知与同意
        </h2>
        <p id={descId} className="text-sm text-neutral-700">
          登录本门户后，您可查看孩子（或本人）的课表，并提交改期申请。我们会处理登录账号信息、
          课表相关信息，以及您提交的改期申请及原因。若被查看人为未成年人，请由监护人代为阅读并同意。
        </p>
        <p className="text-sm text-neutral-700">
          我们依据加拿大《个人信息保护及电子文件法》（PIPEDA）处理上述信息。详情请阅读
          <Link href="/privacy" className="mx-1 underline">
            数据处理告知
          </Link>
          。点击下方按钮即表示您已阅读并同意上述数据处理方式。
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div>
          <button
            type="button"
            onClick={consent}
            disabled={pending}
            className="rounded bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {pending ? '提交中…' : '我已阅读并同意'}
          </button>
        </div>
        <p id={disclosureId} className="text-xs text-neutral-500">
          关闭此窗口即视为您已知悉并同意本告知所述的数据处理方式。
        </p>
      </section>
    </div>
  )
}
