import 'server-only'
import crypto from 'node:crypto'

// P6-5: server-enforced draft-and-confirm for MCP write tools. A *_preview tool issues a token
// bound to a SHA-256 hash of the (parsed) payload; the *_confirm tool executes ONLY when handed
// back a token that exists, is unexpired, and whose bound hash matches the resubmitted payload.
// The model cannot skip confirmation — the write core is unreachable without a valid token.
//
// MUST be module scope: mcp-handler rebuilds a fresh McpServer per request (stateless), so a
// store inside the handler callback would be empty every call. Single-VPS MVP makes an in-process
// Map correct; for a future multi-instance deploy swap this for a signed stateless token.

const TTL_MS = 5 * 60_000
const store = new Map<string, { payloadHash: string; expiresAt: number }>()

export function hashPayload(payload: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

// SEC6: the store only ever shrinks on consume — a preview that is never confirmed would linger until
// process restart, a slow unbounded leak. Sweep expired entries lazily on each issue (O(n) with small
// n, gated by the single trusted MCP bearer's preview volume). `now` is injectable so it stays
// deterministically testable.
function sweepExpired(now: number): void {
  for (const [token, entry] of store) {
    if (entry.expiresAt < now) store.delete(token)
  }
}

export function issueConfirmation(payload: unknown, now: number = Date.now()): string {
  sweepExpired(now)
  const token = crypto.randomUUID()
  store.set(token, { payloadHash: hashPayload(payload), expiresAt: now + TTL_MS })
  return token
}

// Observability/test hook: the number of pending (issued-but-not-consumed) confirmations. Lets the
// SEC6 sweep test assert expired entries are actually purged from the store, not merely rejected.
export function confirmationStoreSize(): number {
  return store.size
}

// Single-use: ALWAYS consumes the token. Returns true only if it existed, is unexpired, AND the
// resubmitted payload hashes to the same value it was bound to.
export function consumeConfirmation(
  token: string,
  payload: unknown,
  now: number = Date.now(),
): boolean {
  const pending = store.get(token)
  if (!pending) return false
  store.delete(token)
  return pending.expiresAt >= now && pending.payloadHash === hashPayload(payload)
}
