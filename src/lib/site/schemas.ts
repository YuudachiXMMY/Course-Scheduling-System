import * as z from 'zod'

// 官网控制台 + 官网写入端点共用的输入校验 —— 纯 schema，无 DB、无 server-only，
// 所以 Client Component 也能 import(弹窗表单要用同一份规则做即时校验)。
// 从官网仓 src/routes/api/admin/popups/schema.ts 及两个公开端点的 schema 移植。

// ── 弹窗 ────────────────────────────────────────────────────────────────────────────────────
// 弹窗 CTA 链接必须是 http(s)。裸 z.string().url() 会连 javascript: / data: 一起放行，
// 而这个值会被渲染进官网每个访客浏览器的 <a href={buttonLink}> —— 那是存储型 XSS。
// 拒掉所有非 http(s) 协议(顺带挡住协议相对的 //、mailto:、tel:、vbscript:)。
const httpUrl = z
  .string()
  .url('必须是合法的 URL')
  .refine((u) => /^https?:\/\//i.test(u), '必须是 http(s) 链接')

// 两个日期字段在表单里是 datetime-local 的字符串或空串。空串在 Server Action 的 FormData 里
// 不可避免，所以 schema 层面就接受它并视作"清空"，而不是让调用方各自做空串判断。
const optionalDateTime = z.union([
  z.iso.datetime({ offset: true }),
  z.iso.datetime(),
  z.literal(''),
])

export const createPopupSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(200, '标题过长'),
  content: z.string().min(1, '内容不能为空').max(5000, '内容过长'),
  buttonText: z.string().max(100, '按钮文案过长').optional().nullable(),
  buttonLink: httpUrl.optional().nullable().or(z.literal('')),
  isActive: z.boolean().default(false),
  startDate: optionalDateTime.optional().nullable(),
  endDate: optionalDateTime.optional().nullable(),
  displayRules: z.string().max(2000, '展示规则过长').optional(),
})

export const updatePopupSchema = z.object({
  id: z.string().min(1, '缺少弹窗 ID'),
  title: z.string().min(1, '标题不能为空').max(200, '标题过长').optional(),
  content: z.string().min(1, '内容不能为空').max(5000, '内容过长').optional(),
  buttonText: z.string().max(100, '按钮文案过长').optional().nullable(),
  buttonLink: httpUrl.optional().nullable().or(z.literal('')),
  isActive: z.boolean().optional(),
  startDate: optionalDateTime.optional().nullable(),
  endDate: optionalDateTime.optional().nullable(),
  displayRules: z.string().max(2000, '展示规则过长').optional().nullable(),
})

export type CreatePopupInput = z.infer<typeof createPopupSchema>
export type UpdatePopupInput = z.infer<typeof updatePopupSchema>

// ── 邮件群发 ────────────────────────────────────────────────────────────────────────────────
export const createCampaignSchema = z.object({
  subject: z.string().min(1, '主题不能为空').max(300, '主题过长'),
  body: z.string().min(1, '正文不能为空').max(100_000, '正文过长'),
})

export const campaignIdSchema = z.object({ id: z.string().min(1, '缺少邮件 ID') })

// ── 官网写入端点(/api/site/*)─────────────────────────────────────────────────────────────
// 这两个 schema 是**第二道**校验:官网自己已经校验过一遍(含 Turnstile、限流、程序 slug 枚举)，
// 但被密钥信任的调用方依然不能免检 —— 共享密钥证明"是官网在调"，不证明"官网没出 bug"。
//
// 刻意**不**复制官网的 LIVE_PROGRAM_SLUGS 枚举:那是官网的业务常量，跨仓复制必然漂移，
// 漂移的后果是悄悄丢弃合法的新项目 slug。这里只约束形状和体积(数量/长度)，枚举归官网。
const programSlug = z.string().min(1).max(64)

export const siteContactSchema = z.object({
  name: z.string().min(1, 'name is required').max(200),
  email: z.email().max(320),
  phone: z.string().max(50).optional().nullable(),
  message: z.string().max(5000).optional().nullable(),
  subscribe: z.boolean().default(false),
  locale: z.enum(['en', 'zh']).optional().nullable(),
  grade: z.coerce.number().int().min(4).max(12).optional().nullable(),
  programs: z.array(programSlug).max(6).default([]),
  topic: z.enum(['program', 'join', 'general']).optional().nullable(),
  source: z.string().max(200).optional().nullable(),
})

export const siteSubscribeSchema = z.object({
  email: z.email().max(320),
  name: z.string().max(200).optional().nullable(),
})

export type SiteContactInput = z.infer<typeof siteContactSchema>
export type SiteSubscribeInput = z.infer<typeof siteSubscribeSchema>

// subscribe 的三态结果。官网靠这个判别式还原它原来的行为:
//   created        → 发欢迎信(只有真正插入的那一方发，避免并发重复发信)
//   reactivated    → 不发信(此人之前退订过，这次只是恢复)
//   already_active → 官网回 409「该邮箱已订阅」
export type SubscribeOutcome = 'created' | 'reactivated' | 'already_active'
