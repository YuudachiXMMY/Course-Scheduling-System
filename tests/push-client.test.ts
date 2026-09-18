import { describe, it, expect, vi, afterEach } from 'vitest'

// push-client.ts is browser-only Web Push glue (P7b). The vitest env is `node`, so window/navigator/
// Notification are stubbed per test. The module captures `VAPID_PUBLIC_KEY = process.env.
// NEXT_PUBLIC_VAPID_PUBLIC_KEY` at LOAD time, so each scenario re-imports it via vi.resetModules()
// after setting the env — that is why the tests load the module through the loadPushClient() helper.

// The classic example VAPID public key (base64url, P-256 uncompressed point → 65 raw bytes).
const VAPID =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8'

// Mirror the module's base64url → bytes decoding so we can assert applicationServerKey exactly.
function expectedKeyBytes(base64url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4)
  const b64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/')
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

// Fresh module instance so the load-time env capture re-runs against the stubbed value.
async function loadPushClient(vapid: string) {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', vapid)
  return import('@/lib/push-client')
}

type SetupOpts = {
  permission?: NotificationPermission
  existing?: unknown
  subscribeResult?: unknown
}

// Install a supported-browser global surface. Returns the individual mocks for call assertions.
function stubSupportedBrowser(opts: SetupOpts = {}) {
  const requestPermission = vi.fn().mockResolvedValue(opts.permission ?? 'granted')
  const getSubscription = vi.fn().mockResolvedValue(opts.existing ?? null)
  const subscribe = vi
    .fn()
    .mockResolvedValue(
      opts.subscribeResult ?? { toJSON: () => ({ endpoint: 'https://push.example/new' }) },
    )
  const registration = { pushManager: { getSubscription, subscribe } }
  const notification = { requestPermission }
  vi.stubGlobal('Notification', notification)
  vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve(registration) } })
  vi.stubGlobal('window', { PushManager: function PushManager() {}, Notification: notification })
  return { requestPermission, getSubscription, subscribe }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('subscribeToPush', () => {
  it('returns null when the browser lacks push support (no window)', async () => {
    // No browser globals stubbed → pushSupported() is false even with a VAPID key configured.
    const { subscribeToPush } = await loadPushClient(VAPID)
    expect(await subscribeToPush()).toBeNull()
  })

  it('returns null when the VAPID public key is not configured', async () => {
    const m = stubSupportedBrowser()
    const { subscribeToPush } = await loadPushClient('') // empty → falsy VAPID_PUBLIC_KEY
    expect(await subscribeToPush()).toBeNull()
    expect(m.requestPermission).not.toHaveBeenCalled() // bails before touching the browser
  })

  it('returns null when the user denies notification permission', async () => {
    const m = stubSupportedBrowser({ permission: 'denied' })
    const { subscribeToPush } = await loadPushClient(VAPID)
    expect(await subscribeToPush()).toBeNull()
    expect(m.subscribe).not.toHaveBeenCalled() // never subscribes without permission
  })

  it('reuses an existing browser subscription instead of creating a duplicate', async () => {
    const existing = { toJSON: () => ({ endpoint: 'https://push.example/existing' }) }
    const m = stubSupportedBrowser({ existing })
    const { subscribeToPush } = await loadPushClient(VAPID)
    expect(await subscribeToPush()).toEqual({ endpoint: 'https://push.example/existing' })
    expect(m.subscribe).not.toHaveBeenCalled()
  })

  it('creates a new subscription with the decoded VAPID key when none exists', async () => {
    const m = stubSupportedBrowser() // getSubscription → null, subscribe → new
    const { subscribeToPush } = await loadPushClient(VAPID)
    const res = await subscribeToPush()

    expect(res).toEqual({ endpoint: 'https://push.example/new' })
    expect(m.subscribe).toHaveBeenCalledTimes(1)
    const arg = m.subscribe.mock.calls[0][0] as {
      userVisibleOnly: boolean
      applicationServerKey: Uint8Array
    }
    expect(arg.userVisibleOnly).toBe(true)
    expect(arg.applicationServerKey).toBeInstanceOf(Uint8Array)
    const expected = expectedKeyBytes(VAPID)
    expect(arg.applicationServerKey.length).toBe(expected.length)
    expect(Array.from(arg.applicationServerKey)).toEqual(Array.from(expected))
  })
})

describe('unsubscribeFromPush', () => {
  it('returns null when the browser lacks push support', async () => {
    const { unsubscribeFromPush } = await loadPushClient(VAPID)
    expect(await unsubscribeFromPush()).toBeNull()
  })

  it('returns null when there is no active subscription', async () => {
    stubSupportedBrowser({ existing: null })
    const { unsubscribeFromPush } = await loadPushClient(VAPID)
    expect(await unsubscribeFromPush()).toBeNull()
  })

  it('unsubscribes and returns the removed endpoint', async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true)
    const existing = { endpoint: 'https://push.example/gone', unsubscribe }
    stubSupportedBrowser({ existing })
    const { unsubscribeFromPush } = await loadPushClient(VAPID)
    expect(await unsubscribeFromPush()).toBe('https://push.example/gone')
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
