'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/*
 * Transient inline success feedback WITHOUT a toast library. `show('已保存')` renders a short-lived
 * message the caller places inline (see `flash`); it auto-clears after `ttl` ms. Consumers wrap the
 * value in an aria-live region so screen readers announce it, e.g.
 *
 *   const { flash, show } = useFlash()
 *   …
 *   {flash && <span aria-live="polite" className="text-xs text-green-700">{flash}</span>}
 *
 * The one timer is tracked in a ref and cleared on the next show()/unmount so overlapping successes
 * never leave a dangling clear that wipes a newer message.
 */
export function useFlash(ttl = 2000) {
  const [flash, setFlash] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const show = useCallback(
    (message: string) => {
      clear()
      setFlash(message)
      timer.current = setTimeout(() => {
        setFlash(null)
        timer.current = null
      }, ttl)
    },
    [clear, ttl],
  )

  useEffect(() => clear, [clear])

  return { flash, show }
}
