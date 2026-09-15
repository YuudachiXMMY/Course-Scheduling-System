'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { acknowledgeConsent } from './consent-actions'

// First-login consent screen: blocks the portal until the guardian/student acknowledges the data
// notice. On acknowledge, the server stamps portalLink.consentedAt and this gate never reappears.
export default function ConsentGate() {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function acknowledge() {
    setError(null)
    startTransition(async () => {
      try {
        await acknowledgeConsent()
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : '提交失败')
      }
    })
  }

  return (
    <section className="mx-auto flex max-w-xl flex-col gap-4 rounded border border-neutral-200 p-6">
      <h2 className="text-lg font-semibold">数据处理告知与同意</h2>
      <p className="text-sm text-neutral-700">
        登录本门户后，您可查看孩子（或本人）的课表，并提交改期申请。我们会处理登录账号信息、
        课表相关信息，以及您提交的改期申请及原因。若被查看人为未成年人，请由监护人代为阅读并同意。
      </p>
      <p className="text-sm text-neutral-700">
        详情请阅读
        <Link href="/privacy" className="mx-1 underline">
          数据处理告知
        </Link>
        。点击下方按钮即表示您已阅读并同意上述数据处理方式。
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div>
        <button
          type="button"
          onClick={acknowledge}
          disabled={pending}
          className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {pending ? '提交中…' : '我已阅读并同意'}
        </button>
      </div>
    </section>
  )
}
