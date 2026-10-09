import 'server-only'
import { AuthError, requireAuthContext, type AuthContext } from '@/auth/context'

// 官网控制台的唯一授权门槛:**平台超级管理员**(user.role 含 'superadmin' → ctx.isPlatformAdmin)。
//
// 为什么不是租户 RBAC:这五张表是平台全局的(只有一个官网)，没有 tenant_id,所以
// "owner/admin 对自己机构有权" 这套语义在这里无从表达 —— 一个机构的 admin 凭什么能读另一批
// 人的询盘和整个订阅列表?唯一说得通的主体是自托管运营方本人，也就是超管。
// 这与 /dashboard/users 管理员 tab 的分级一致(那里也是"仅超管可写 admin 账号")。

/**
 * 同步断言:这个 ctx 是否可以操作官网数据。
 *
 * 每个 core 的第一行都调它(纵深防御)——导航项隐藏和 layout 跳转都只是 UX,
 * 手搓的 Server Action 请求不会因为按钮没渲染就被挡住。
 *
 * 之所以是"接收 ctx"而不是"自己去解析会话":
 *   · 与本仓既有约定一致(listPortalUsers(ctx) / createStaffUserCore(ctx, …));
 *   · 一次请求只解析一次会话 —— 否则一个页面调两个 core 就要查两遍 session + member;
 *   · core 因此可脱离 next/headers 做 DB 测试(见 tests/site-db.test.ts)。
 */
export function assertSiteAdmin(ctx: AuthContext): void {
  if (!ctx.isPlatformAdmin) throw new AuthError('FORBIDDEN')
}

/** 解析当前请求的 ctx 并断言其为超管。Server Action / 页面在入口调一次，再把 ctx 传给各 core。 */
export async function requireSiteAdmin(): Promise<AuthContext> {
  const ctx = await requireAuthContext()
  assertSiteAdmin(ctx)
  return ctx
}
