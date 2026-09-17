'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setStaffRole, deactivateStaff, reactivateStaff } from './staff-actions'

// Per-row staff controls. All props are serializable (no function props) so these Client Components can be
// rendered by the RSC teachers/admins tabs. The server tab decides WHETHER to render each control (tier +
// self + last-owner visibility); the Server Action + core re-check every rule (defence in depth).

// A <select> that changes a member's role on pick. Reverts the visible value if the action fails so the
// UI never lies about the persisted role.
export function StaffRoleControl({
  userId,
  currentRole,
  options,
}: {
  userId: string
  currentRole: string
  options: { value: string; label: string }[]
}) {
  const [role, setRole] = useState(currentRole)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function change(next: string) {
    if (next === role) return
    const prev = role
    setRole(next)
    setError(null)
    startTransition(async () => {
      const res = await setStaffRole(userId, next)
      if (!res.ok) {
        setError(res.error)
        setRole(prev)
        return
      }
      router.refresh()
    })
  }

  return (
    <span className="flex items-center gap-1">
      <select
        className="rounded border border-neutral-300 px-2 py-0.5 text-xs disabled:opacity-50"
        value={role}
        disabled={pending}
        aria-label="角色"
        onChange={(e) => change(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  )
}

// 停用/启用 toggle. `banned` reflects the current state; the button flips it.
export function StaffActiveToggle({ userId, banned }: { userId: string; banned: boolean }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function toggle() {
    setError(null)
    startTransition(async () => {
      const res = banned ? await reactivateStaff(userId) : await deactivateStaff(userId)
      if (!res.ok) {
        setError(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        disabled={pending}
        className={
          banned
            ? 'rounded border border-green-300 px-2 py-0.5 text-xs text-green-700 hover:bg-green-50 disabled:opacity-50'
            : 'rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50'
        }
        onClick={toggle}
      >
        {pending ? '处理中…' : banned ? '启用' : '停用'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  )
}
