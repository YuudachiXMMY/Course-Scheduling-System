import type { AuthInfo } from '@modelcontextprotocol/server'
import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { timingSafeEqual } from 'node:crypto'
import { registerCourseSchedulingTools } from '@/mcp/register-tools'
import { env } from '@/env'

// P6-2: Claude MCP connector — stateless Streamable HTTP via mcp-handler 2.x.
// nodejs runtime is REQUIRED (pg sockets + `server-only` libs cannot run on edge).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Vercel ceiling; a no-op on the self-hosted VPS but harmless.

const handler = createMcpHandler((server) => registerCourseSchedulingTools(server), {
  serverInfo: { name: 'course-scheduling-mcp', version: '1.0.0' },
})

// Static bearer gate. Returns undefined (→ 401) when the token is unset or mismatched.
// Constant-time compare; equal-length guard because timingSafeEqual throws on length mismatch.
const verifyToken = async (_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> => {
  const expected = env.MCP_BEARER_TOKEN
  if (!expected || !bearerToken) return undefined
  const a = Buffer.from(bearerToken)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined
  return {
    token: bearerToken,
    clientId: 'course-scheduler',
    scopes: ['schedule:read', 'schedule:write'],
  }
}

const authHandler = withMcpAuth(handler, verifyToken, {
  required: true, // defaults to false — MUST be true or unauthenticated calls pass through
  resourceUrl: env.MCP_RESOURCE_URL, // audience validation (anti confused-deputy) when set
})

// L-mcp: audience (confused-deputy) validation is a silent no-op unless MCP_RESOURCE_URL is set. The
// static bearer still gates every call (required:true above), so this is defence-in-depth, not the sole
// control — but an operator should still notice the gap.
const AUDIENCE_DISABLED = Boolean(env.MCP_BEARER_TOKEN) && !env.MCP_RESOURCE_URL
const AUDIENCE_WARNING =
  '[mcp] MCP_RESOURCE_URL 未设置：audience（confused-deputy）校验被跳过；生产环境建议设为公开 MCP URL。'

// L-mcp-audience: in PRODUCTION, refuse to serve MCP with audience validation silently off. If the
// connector is enabled (a bearer is configured) MCP_RESOURCE_URL MUST be set so withMcpAuth actually
// enforces the audience check. Fail closed at module load with a clear, actionable error — the same
// fail-fast posture as env.ts's secret-strength floors, but scoped to THIS route (a broken /api/mcp is
// far better than the whole app), and only in prod so local dev / tests keep the softer warning path.
// The guard is skipped when no bearer is set (MCP off ⇒ AUDIENCE_DISABLED is false) and during
// `next build` (secrets absent from the build context), so it can never break boot or CI.
if (AUDIENCE_DISABLED && env.NODE_ENV === 'production') {
  throw new Error(
    '[mcp] MCP_RESOURCE_URL is required in production when MCP_BEARER_TOKEN is set — set it to the public MCP URL (e.g. https://<host>/api/mcp) so audience (confused-deputy) validation is enforced, not skipped.',
  )
}

// Non-prod (or prod with MCP off): warn once at module load…
if (AUDIENCE_DISABLED) {
  console.warn(AUDIENCE_WARNING)
}

// …and re-emit at request time, throttled to at most hourly. The module-load warning fires once and can
// be lost to a cold-start log-ingestion gap; a throttled request-time re-emit resurfaces the gap without
// spamming a line on every call.
const AUDIENCE_WARN_INTERVAL_MS = 60 * 60 * 1000
let lastAudienceWarnAt = 0
const guardedHandler = (
  ...args: Parameters<typeof authHandler>
): ReturnType<typeof authHandler> => {
  if (AUDIENCE_DISABLED) {
    const now = Date.now()
    if (now - lastAudienceWarnAt > AUDIENCE_WARN_INTERVAL_MS) {
      lastAudienceWarnAt = now
      console.warn(AUDIENCE_WARNING)
    }
  }
  return authHandler(...args)
}

// Stateless → only GET + POST (no SSE/DELETE session, no Redis). The [transport] segment is a
// harmless 2.x holdover; clients POST to /api/mcp.
export { guardedHandler as GET, guardedHandler as POST }
