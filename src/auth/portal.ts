import 'server-only'
import { and, eq } from 'drizzle-orm'
import { forTenant } from '@/db/tenant'
import { portalLink } from '@/db/schema'
import { BusinessError } from '@/lib/errors'
import type { AuthContext } from '@/auth/context'

// Phase 7a: parent/student are the "portal" roles — they log into /portal, not /dashboard.
const PORTAL_ROLES = ['parent', 'student'] as const

// member.role may be comma-separated (Better Auth multi-role); match within the parsed list.
export function isPortalRole(role: string): boolean {
  const roles = role.split(',').map((r) => r.trim())
  return roles.some((r) => (PORTAL_ROLES as readonly string[]).includes(r))
}

// The student rows this authenticated user is linked to (P7a-5). Row-level scope is derived ONLY
// from portalLink keyed by the verified ctx.userId — never from a request param. forTenant already
// scopes by tenant, so the extra predicate is userId only.
export async function resolveLinkedStudentIds(ctx: AuthContext): Promise<string[]> {
  const rows = await forTenant(ctx).select(portalLink, eq(portalLink.userId, ctx.userId))
  return rows.map((r) => r.studentId)
}

// Ownership guard for the reschedule write path: the acting user must be linked to `studentId`.
export async function assertLinkedToStudent(ctx: AuthContext, studentId: string): Promise<void> {
  const rows = await forTenant(ctx).select(
    portalLink,
    and(eq(portalLink.userId, ctx.userId), eq(portalLink.studentId, studentId)),
  )
  if (rows.length === 0) throw new BusinessError('无权访问该学生')
}

// 服务端同意门复检（Slice F / P7a-9）。layout.tsx 的 ConsentGate 只在渲染层拦截，是 UX 级；门户的
// Server Action 与数据加载器（独立 POST 端点 / RSC 数据函数）必须在触碰个人数据前独立复检 consentedAt，
// 否则一个从未点"我已阅读并同意"的家长/学生可直接调用这些动作，绕过 PIPL/未成年人同意门。判定与
// layout 的 needsConsent 完全一致：有 portalLink 且存在未 stamp 的链接即视为未同意（多孩家长同意一次
// 会 stamp 全部）。仅约束门户角色（parent/student）——staff 不受同意门约束，直接放行。
export async function requireConsent(ctx: AuthContext): Promise<void> {
  if (!isPortalRole(ctx.role)) return // staff 不受同意门约束
  const rows = await forTenant(ctx).select(portalLink, eq(portalLink.userId, ctx.userId))
  const needsConsent = rows.length > 0 && rows.some((r) => !r.consentedAt)
  if (needsConsent) throw new BusinessError('请先阅读并同意隐私条款')
}
