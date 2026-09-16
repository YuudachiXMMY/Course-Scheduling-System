'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { getOrCreateFeed, rotateFeed, revokeFeed } from './actions'

export default function FeedPanel({
  hasFeed,
  httpsUrl,
  webcalUrl,
}: {
  hasFeed: boolean
  httpsUrl: string | null
  webcalUrl: string | null
}) {
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const router = useRouter()

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setMsg('已复制链接')
    } catch {
      setMsg('复制失败，请手动复制')
    }
  }

  function create() {
    startTransition(async () => {
      await getOrCreateFeed()
      setMsg('已生成订阅链接')
      router.refresh()
    })
  }

  function rotate() {
    if (!window.confirm('重新生成后，旧链接会立即失效，已订阅的日历需要重新订阅。确定继续？'))
      return
    startTransition(async () => {
      await rotateFeed()
      setMsg('已重新生成链接')
      router.refresh()
    })
  }

  function revoke() {
    if (!window.confirm('停用后，该订阅链接会立即失效。确定继续？')) return
    startTransition(async () => {
      await revokeFeed()
      setMsg('已停用订阅')
      router.refresh()
    })
  }

  if (!hasFeed || !httpsUrl || !webcalUrl) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4 shadow-sm">
        <p className="text-sm text-neutral-600">尚未生成订阅链接。</p>
        <button
          type="button"
          disabled={pending}
          onClick={create}
          className="self-start rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          生成订阅链接
        </button>
        {msg && <p className="text-xs text-green-700">{msg}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-neutral-200 p-4 shadow-sm">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-neutral-500">一键订阅（webcal）</span>
        <div className="flex items-center gap-2">
          <a href={webcalUrl} className="text-sm break-all text-blue-600 hover:underline">
            {webcalUrl}
          </a>
          <button
            type="button"
            disabled={pending}
            onClick={() => copy(webcalUrl)}
            className="shrink-0 rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            复制
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-neutral-500">手动粘贴（https）</span>
        <div className="flex items-center gap-2">
          <code className="rounded bg-neutral-100 px-1 py-0.5 text-sm break-all text-neutral-800">
            {httpsUrl}
          </code>
          <button
            type="button"
            disabled={pending}
            onClick={() => copy(httpsUrl)}
            className="shrink-0 rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            复制
          </button>
        </div>
      </div>

      <div className="flex gap-2 border-t border-neutral-200 pt-3">
        <button
          type="button"
          disabled={pending}
          onClick={rotate}
          className="rounded border border-neutral-300 px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          重新生成链接
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={revoke}
          className="rounded border border-red-300 px-3 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          停用
        </button>
      </div>

      {msg && <p className="text-xs text-green-700">{msg}</p>}
    </div>
  )
}
