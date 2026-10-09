import 'server-only'
import nodemailer from 'nodemailer'
import { env } from '@/env'

// SMTP 发信(Stalwart 邮件服务器)——从官网仓 src/lib/server/mail.ts 移植。
//
// 与官网版的唯一差异:**只保留群发连接池**。官网有两个池(事务池给订阅/询盘的单发确认信、
// 群发池给 campaign 批量)，而本项目这边只有邮件群发一个发信场景 —— 订阅/询盘的确认信仍由
// 官网自己发(它才持有双语文案和 Turnstile 上下文)。把一个没有调用方的事务池搬过来就是死代码,
// 所以这里一个池。若将来本项目要发单封事务邮件，照官网那样再加一个独立池(别共用群发池:
// 一封用户在等的确认信不该排在一次群发批次后面)。
//
// 未配置 SMTP 时所有 transport 为 null。注意这里**不是**优雅 no-op 就够了:群发路径必须
// 用 isMailConfigured 先硬失败(503)，否则会把每个收件人都记成已送达、campaign 标记 sent,
// 结果永久无法重发。见 site/campaigns-core.ts 的注释。

export type SendMailOptions = { to: string; subject: string; html: string; from?: string }

const SMTP_HOST = env.SMTP_HOST
// 465 = 隐式 TLS(Stalwart 的提交端口);内网路径上 587 的 STARTTLS 会被拒。
const SMTP_PORT = Number(env.SMTP_PORT ?? '465')
const SMTP_USER = env.SMTP_USER
const SMTP_PASSWORD = env.SMTP_PASSWORD
const SMTP_FROM = env.SMTP_FROM ?? 'Ithaca Family Academy <noreply@ithacateens.com>'
// 仅内网 Docker 路径:应用通过网络别名(`stalwart`)连容器，而该别名永远匹配不上证书里的
// 公网主机名(mail.<domain>)，于是 CN/SAN 校验失败、每封信都抛。置 SMTP_TLS_INSECURE=1
// 保留加密(隐式 TLS)但跳过主机名/链校验 —— 在可信内网上是安全的，也是用内网主机的唯一办法。
// 指向公网提交主机(证书能对上)时务必不要设它。
const SMTP_TLS_INSECURE = env.SMTP_TLS_INSECURE === '1' || env.SMTP_TLS_INSECURE === 'true'

const isConfigured = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASSWORD)

// 允许开启 SMTP_TLS_INSECURE 的内网 Docker 别名白名单:它们的证书无法对上公网主机名，
// 且流量从不离开可信内网。不在白名单上的一律按"看起来像公网"处理，于是**默认拒绝**不安全 TLS
// —— 带点的 FQDN、IPv6 字面量、未知单段主机名全部 fail closed。
const INTERNAL_TLS_INSECURE_HOSTS = new Set(['stalwart'])

/**
 * 硬失败守卫，抽成纯函数以便在不加载 env 驱动的 transport 的前提下单测(与 splitSettled 同理)。
 *
 * 对不在内网白名单上的主机关掉 TLS 校验，等于悄悄把这条链路降级为不验证证书，暴露在中间人
 * 攻击下 —— 所以这里**拒绝启动**而不只是打个 warning。
 */
export function assertTlsConfigSafe(host: string | undefined, tlsInsecure: boolean): void {
  if (tlsInsecure && !(host && INTERNAL_TLS_INSECURE_HOSTS.has(host))) {
    throw new Error(
      `[mail] 拒绝启动:SMTP_TLS_INSECURE 已设置，但主机 "${host ?? '(未设置)'}" 不是已知的内网别名。` +
        '这会在一个本该能验证证书的主机上关闭证书校验，把提交链路暴露给中间人攻击。' +
        `SMTP_TLS_INSECURE 仅对内网 Docker 别名(${[...INTERNAL_TLS_INSECURE_HOSTS].join(', ')})有效，其余情况请取消设置。`,
    )
  }
}

// 暴露给群发处理器，使其在 SMTP 未配置时硬失败(503)，而不是写出一份幻影投递台账并把
// campaign 标成 'sent' —— 那会让这封信永久无法重发。
export const isMailConfigured = isConfigured

if (isConfigured) {
  if (Number.isNaN(SMTP_PORT)) {
    console.error(`[mail] SMTP_PORT 不是数字("${env.SMTP_PORT}")—— 发信将失败`)
  } else if (!env.SMTP_PORT) {
    console.warn('[mail] SMTP_PORT 未设置 —— 默认 465(隐式 TLS);如需覆盖请显式设置')
  }
  // 在危险的误配置(不安全 TLS + 公网主机)上拒绝启动 —— 见 assertTlsConfigSafe。
  // 在此处抛出会在模块首次加载时暴露(fail loud)，而不是悄悄躺在日志里。
  assertTlsConfigSafe(SMTP_HOST, SMTP_TLS_INSECURE)
  console.info(
    `[mail] SMTP ready: ${SMTP_HOST}:${SMTP_PORT} secure=${SMTP_PORT === 465} tlsVerify=${!SMTP_TLS_INSECURE} (bulk=5)`,
  )
}

// 显式超时:对着一台已死/被黑洞的 Stalwart 要快速失败，而不是耗在 nodemailer 的默认值上
// (连接 120s、socket 600s)。
const SMTP_TIMEOUTS = {
  connectionTimeout: 10_000, // 内网提交路径的 TCP 连接预算
  greetingTimeout: 10_000, // 等 SMTP banner
  socketTimeout: 30_000, // 把卡住的发送压到远低于 600s 的默认值
} as const

// 群发池。池化会限制并发 SMTP 连接数:超出 maxConnections 的发送在内部排队，而不是每封信开一条
// socket;maxMessages 在 N 封后回收连接，避开长寿 socket 的边缘问题。有界连接也让自托管的
// Stalwart 不至于被打爆。
//
function createBulkTransport() {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465, // 465 = 隐式 TLS;587 = STARTTLS
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    // 只有显式选择(内网主机路径)时才降级证书校验;否则保持 nodemailer 的默认完整校验。
    ...(SMTP_TLS_INSECURE ? { tls: { rejectUnauthorized: false } } : {}),
    ...SMTP_TIMEOUTS,
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
  })
}

// HMR 缓存:Next 开发模式每次保存都会重新执行模块，不缓存的话每次都泄漏一个新连接池，
// 直到 SMTP 服务器拒绝连接(与 src/db/index.ts 对 pg 连接池的处理同理)。
const g = globalThis as unknown as { __bulkMailTransport?: ReturnType<typeof createBulkTransport> }

const bulkTransporter = isConfigured ? (g.__bulkMailTransport ?? createBulkTransport()) : null

if (bulkTransporter && process.env.NODE_ENV !== 'production')
  g.__bulkMailTransport = bulkTransporter

/** 关闭池内 socket，免得它们占着事件循环、拖慢进程优雅退出。transport 从未创建时是 no-op。 */
export function closeMailTransports(): void {
  bulkTransporter?.close()
}

// 官网把这个注册在 hooks.server.ts(SvelteKit 的单一入口)。Next 没有等价的单入口钩子，
// 所以就注册在 transport 所在的这个模块里 —— 反而更内聚:谁持有 socket 谁负责关。
// process.once 保证重复 import / HMR 重执行不会堆叠监听器。
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => closeMailTransports())
}

export type BatchSendResult = { delivered: string[]; failed: Array<{ to: string; error: string }> }

/**
 * 纯函数:按下标把 settled 结果切回输入消息(已送达 vs 失败的收件人)。
 * 抽出来是为了在没有真实 SMTP 服务器的情况下可单测(见 tests/site-mail.test.ts)。
 */
export function splitSettled(
  messages: SendMailOptions[],
  results: PromiseSettledResult<void>[],
): BatchSendResult {
  const delivered: string[] = []
  const failed: Array<{ to: string; error: string }> = []
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') delivered.push(messages[i].to)
    else
      failed.push({
        to: messages[i].to,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      })
  })
  return { delivered, failed }
}

async function sendOne(options: SendMailOptions): Promise<void> {
  if (!bulkTransporter) {
    console.warn('[mail] SMTP 未配置 —— 跳过发信')
    return
  }
  await bulkTransporter.sendMail({
    from: options.from ?? SMTP_FROM,
    to: options.to,
    subject: options.subject,
    html: options.html,
  })
}

/**
 * 逐封幂等:调用方只把 `delivered` 记入台账，所以"部分批次失败后重试"永远不会对连接池
 * 已经送达的人重复轰炸。allSettled 永不 reject，所以调用方的批次循环总能继续(尾部不会被跳过)。
 * 并发由池化 transport(maxConnections)兜住。
 */
export async function sendMailBatchSettled(messages: SendMailOptions[]): Promise<BatchSendResult> {
  return splitSettled(messages, await Promise.allSettled(messages.map((m) => sendOne(m))))
}
