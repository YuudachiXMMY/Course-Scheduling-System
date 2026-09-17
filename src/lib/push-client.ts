// P7b: browser-only Web Push helpers. NOT `server-only` — these run in the client bundle and are
// only ever called from an explicit user gesture (never auto-fired on load, per the P3-10 invariant).
// The VAPID public key is inlined at build via NEXT_PUBLIC_VAPID_PUBLIC_KEY; when unset every entry
// point returns null so the subscribe UI stays hidden.
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

// applicationServerKey must be the VAPID public key as raw bytes (base64url → Uint8Array). Backed by
// an explicit ArrayBuffer so the type is Uint8Array<ArrayBuffer> (a valid BufferSource — a plain
// Uint8Array<ArrayBufferLike> is rejected by pushManager.subscribe's typing under TS 5.7+).
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

// Request permission + subscribe. Returns the serializable subscription (to hand to the server
// action) or null when unsupported / unconfigured / permission denied. Reuses an existing browser
// subscription when present so we never create duplicates.
export async function subscribeToPush(): Promise<PushSubscriptionJSON | null> {
  if (!pushSupported() || !VAPID_PUBLIC_KEY) return null
  const reg = await navigator.serviceWorker.ready
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return null
  const existing = await reg.pushManager.getSubscription()
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    }))
  return sub.toJSON()
}

// Unsubscribe the current browser and return the endpoint that was removed (so the caller can prune
// the server row), or null when there was nothing to remove.
export async function unsubscribeFromPush(): Promise<string | null> {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return null
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  return endpoint
}
