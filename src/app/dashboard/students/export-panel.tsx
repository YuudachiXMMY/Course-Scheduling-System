'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { getOrCreateShare, rotateShare, revokeShare } from './share-actions'

export default function ExportPanel({
  studentId,
  token,
  shareOrigin,
}: {
  studentId: string
  token: string | null
  shareOrigin: string
}) {
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const shareUrl = token ? `${shareOrigin}/s/${token}` : null
  const pngUrl = `/api/export/student/${studentId}/png`
  const icsUrl = `/api/export/student/${studentId}/ics`

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setMsg('已复制链接')
    } catch {
      setMsg('复制失败，请手动复制')
    }
  }

  // B30: share-actions 在归属/权限失败时会「抛」（生产被 React #441 脱敏）。startTransition 内的
  // await 若无 try/catch，rejection 会冒泡到最近的错误边界。逐个包裹并把失败落到 setError 呈现。
  function createOrCopy() {
    if (shareUrl) {
      void copy(shareUrl)
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        const { token: created } = await getOrCreateShare(studentId)
        await copy(`${shareOrigin}/s/${created}`)
        setMsg('已生成并复制分享链接')
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : '生成分享链接失败')
      }
    })
  }

  function rotate() {
    if (!window.confirm('重新生成后，旧链接会立即失效。确定继续？')) return
    setError(null)
    startTransition(async () => {
      try {
        await rotateShare(studentId)
        setMsg('已重新生成链接')
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : '重新生成失败')
      }
    })
  }

  function revoke() {
    if (!window.confirm('停用后，该分享链接会立即失效。确定继续？')) return
    setError(null)
    startTransition(async () => {
      try {
        await revokeShare(studentId)
        setMsg('已停用分享')
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : '停用失败')
      }
    })
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4 shadow-sm">
      {shareUrl ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-500">分享链接</span>
          <div className="flex items-center gap-2">
            <code className="rounded bg-neutral-100 px-1 py-0.5 text-sm break-all text-neutral-800">
              {shareUrl}
            </code>
            <button
              type="button"
              disabled={pending}
              onClick={() => copy(shareUrl)}
              className="shrink-0 rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              复制
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-neutral-600">尚未生成分享链接。</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={createOrCopy}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {shareUrl ? '复制分享链接' : '生成分享链接'}
        </button>
        <a
          href={pngUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          下载图片
        </a>
        <a
          href={icsUrl}
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          下载 .ics
        </a>
      </div>

      {shareUrl && (
        <div className="flex gap-2 border-t border-neutral-200 pt-3">
          <button
            type="button"
            disabled={pending}
            onClick={rotate}
            className="rounded border border-neutral-300 px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            重新生成
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
      )}

      {msg && <p className="text-xs text-green-700">{msg}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
