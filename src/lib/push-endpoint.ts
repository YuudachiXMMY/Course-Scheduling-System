import { z } from 'zod'

// B3/B4/B5/B49 — Web Push SSRF guard. A push `endpoint` is a URL the SERVER later dereferences via
// web-push (url.parse → https.request, carrying the VAPID auth header). It is fully attacker-controlled
// at subscribe time, so persisting/sending an arbitrary endpoint is a blind SSRF (CWE-918): an attacker
// registers e.g. http://169.254.169.254/... or an internal address and the unattended reminder cron
// dereferences it. Defence: an ALLOW-LIST of the known browser push services (https only). Anything not
// on the list — http, private/loopback/link-local IPs, cloud metadata — is rejected by construction.

// Exact hosts operated by the major browser push services.
const ALLOWED_PUSH_HOSTS = new Set([
  'fcm.googleapis.com', // Chrome / Chromium (FCM)
  'android.googleapis.com', // legacy FCM (fcm/send)
  'updates.push.services.mozilla.com', // Firefox (autopush)
  'web.push.apple.com', // Safari / WebKit (APNs Web Push)
])

// Suffixes for services that shard across regional sub-domains. endsWith the suffix AND be strictly
// longer than it (so a bare ".notify.windows.com" or a look-alike "evilnotify.windows.com" is rejected —
// the char before the suffix must be part of a real sub-domain label, i.e. the suffix starts with '.').
const ALLOWED_PUSH_HOST_SUFFIXES = [
  '.notify.windows.com', // Edge / Windows (WNS): <region>.notify.windows.com
  '.push.services.mozilla.com', // future Mozilla autopush shards
]

// Whether an endpoint URL points at a trusted browser push service over https.
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  if (ALLOWED_PUSH_HOSTS.has(host)) return true
  return ALLOWED_PUSH_HOST_SUFFIXES.some((s) => host.length > s.length && host.endsWith(s))
}

// base64url alphabet (RFC 4648 §5), unpadded — the encoding the Push API uses for the ECDH public key
// (p256dh, ~65 bytes → ~88 chars) and the auth secret (16 bytes → ~22 chars).
const BASE64URL = /^[A-Za-z0-9_-]+$/

// Validated subscription payload. Rejects a non-allow-listed endpoint AND malformed keys before either
// touches the DB or web-push. Callers surface `.issues[0].message` as the (Chinese) user-facing error.
export const saveSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .trim()
    .max(2000)
    .refine(isAllowedPushEndpoint, '不受支持的推送服务地址'),
  p256dh: z.string().trim().regex(BASE64URL, 'p256dh 格式无效').min(20).max(200),
  auth: z.string().trim().regex(BASE64URL, 'auth 格式无效').min(16).max(100),
})
