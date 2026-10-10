'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteSubscriber } from '../actions'

export default function DeleteSubscriberButton({ id, email }: { id: string; email: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function run() {
    // 删除订阅者不可撤销 —— 二次确认里带上邮箱，让人看清自己要删的是谁。
    if (!window.confirm(`确定删除订阅者 ${email}？该操作不可撤销。`)) return
    setError(null)
    startTransition(async () => {
      try {
        const res = await deleteSubscriber(id)
        if (!res.ok) {
          setError(res.error)
          return
        }
        // action 已经 revalidatePath,但当前这棵客户端树还持有旧数据 —— refresh 让服务端
        // 重新渲染并把新结果推下来。
        router.refresh()
      } catch {
        setError('删除失败，请稍后重试')
      }
    })
  }

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="text-sm text-red-600 hover:underline disabled:opacity-50"
      >
        {pending ? '删除中…' : '删除'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  )
}
