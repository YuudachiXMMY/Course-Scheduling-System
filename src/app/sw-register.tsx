'use client'

import { useEffect, useState } from 'react'

// The `beforeinstallprompt` event isn't in the DOM lib; type just the bit we use.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
}

// Registers the minimal SW (installability only) and surfaces an unobtrusive install button.
// P3-10: we NEVER auto-fire the prompt and NEVER call Notification.requestPermission() — so
// "install prompt before notification permission" holds trivially. iOS won't fire the event
// (button stays hidden); Add-to-Home-Screen + apple-touch-icon covers iOS.
export function ServiceWorkerRegister() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  if (!deferred) return null
  return (
    <button
      type="button"
      onClick={async () => {
        await deferred.prompt()
        setDeferred(null)
      }}
      className="fixed right-4 bottom-4 rounded bg-neutral-900 px-3 py-2 text-sm text-white shadow"
    >
      安装到主屏幕
    </button>
  )
}
