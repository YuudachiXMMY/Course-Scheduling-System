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
  return { token: bearerToken, clientId: 'course-scheduler', scopes: ['schedule:read', 'schedule:write'] }
}

const authHandler = withMcpAuth(handler, verifyToken, {
  required: true, // defaults to false — MUST be true or unauthenticated calls pass through
  resourceUrl: env.MCP_RESOURCE_URL, // audience validation (anti confused-deputy) when set
})

// L-mcp: audience (confused-deputy) validation is a silent no-op unless MCP_RESOURCE_URL is set. Warn
// once at module load so an operator notices the gap rather than it failing open unremarked. The static
// bearer still gates every call (required:true above), so this is defence-in-depth, not the sole control.
if (env.MCP_BEARER_TOKEN && !env.MCP_RESOURCE_URL) {
  console.warn(
    '[mcp] MCP_RESOURCE_URL 未设置：audience（confused-deputy）校验被跳过；生产环境建议设为公开 MCP URL。',
  )
}

// Stateless → only GET + POST (no SSE/DELETE session, no Redis). The [transport] segment is a
// harmless 2.x holdover; clients POST to /api/mcp.
export { authHandler as GET, authHandler as POST }
