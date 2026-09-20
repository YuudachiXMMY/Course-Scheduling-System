import { createEnv } from '@t3-oss/env-nextjs'
import * as z from 'zod'

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    // P4-9: system Chromium path in the Debian runtime image (/usr/bin/chromium). Optional so
    // local dev (Playwright's bundled Chromium, empty var) and prod both validate.
    PLAYWRIGHT_CHROMIUM_PATH: z.string().optional(),
    // SEC4: escape valve for the headless Chromium OS sandbox (src/lib/browser.ts). The sandbox is
    // ENABLED by default; set CHROMIUM_NO_SANDBOX=true ONLY in a container/runtime that cannot grant
    // unprivileged user namespaces, accepting the documented risk (see docs/adr/0002-*). Anything
    // other than the literal 'true' keeps the sandbox on. Optional so a normal boot enables it.
    CHROMIUM_NO_SANDBOX: z.string().optional(),
    // P6-8: Claude MCP connector (static bearer). ALL OPTIONAL so the app boots without MCP
    // configured — the endpoint stays inert (401) and resolveMcpAuthContext fails fast until set.
    // The min-length constraints still apply WHEN a value is present.
    MCP_BEARER_TOKEN: z.string().min(32).optional(), // static bearer; generate: openssl rand -base64 48
    MCP_ORG_ID: z.string().min(1).optional(), // organizationId (=tenantId) the token acts as
    MCP_USER_ID: z.string().min(1).optional(), // user.id the token acts as (owner member row)
    MCP_RESOURCE_URL: z.url().optional(), // audience for withMcpAuth (anti confused-deputy)
    // P5: Claude drafting for progress reports. OPTIONAL so the app boots without it — report
    // drafting fails fast with a clear message when unset; everything else works. Model defaults
    // to Opus 4.8; set ANTHROPIC_MODEL=claude-haiku-4-5 / claude-sonnet-5 to trade cost for tier.
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_MODEL: z.string().min(1).default('claude-opus-4-8'),
    // P8: 报告起草 provider 切换。默认走 Anthropic(行为不变);设为 'minimax' 改用 MiniMax(CN)。
    REPORT_PROVIDER: z.enum(['anthropic', 'minimax']).default('anthropic'),
    // MiniMax(中国区)OpenAI 兼容端点。OPTIONAL,以便 provider=anthropic 时无需配置即可启动。
    // 注意:CN Key 必须配 api.minimaxi.com(尾字母 i);Global Key 配 api.minimax.io,否则 404/鉴权失败。
    MINIMAX_API_KEY: z.string().min(1).optional(),
    MINIMAX_MODEL: z.string().min(1).default('MiniMax-M3'),
    MINIMAX_BASE_URL: z.url().default('https://api.minimaxi.com/v1'),
    // P7a-10: domain for synthesized placeholder emails when provisioning WeChat-only (no-email)
    // parent/student portal accounts (e.g. portal_<nanoid>@portal.local). Use a domain you control.
    PORTAL_EMAIL_DOMAIN: z.string().min(1).default('portal.local'),
    // Env-seeded default super admin (scripts/seed-admin.ts, run by docker entrypoint after migrate).
    // ADMIN_EMAIL/ADMIN_PASSWORD are OPTIONAL so the app still boots without them — the seed simply
    // skips-with-warning. But because self-service signup is disabled, a FIRST deploy that omits them
    // has nobody who can log in; docker-compose therefore requires them via ${ADMIN_EMAIL:?…}. The
    // ORG_* + NAME values have sensible defaults and are applied at runtime (seed runs post-build,
    // where zod .default()s take effect — skipValidation only bypasses defaults during `next build`).
    ADMIN_EMAIL: z.email().optional(),
    // SEC1: this is the highest-privilege credential in the system (platform super-admin, seeded by
    // scripts/seed-admin.ts) and self-service signup is disabled, so a strong floor matters. Raised
    // 8→16. Kept OPTIONAL so a no-ADMIN boot still cleanly skips the seed (seed-admin.ts warns+skips).
    // NOTE: validated at runtime (skipValidation only bypasses `next build`), so an existing deploy
    // whose ADMIN_PASSWORD is 8–15 chars must be rotated to ≥16 before the next seed/boot.
    ADMIN_PASSWORD: z.string().min(16).optional(),
    ADMIN_NAME: z.string().min(1).default('管理员'),
    DEFAULT_ORG_NAME: z.string().min(1).default('默认机构'),
    DEFAULT_ORG_ID: z.string().min(1).default('org_default'),
    // P7b: shared secret guarding /api/cron/* (constant-time Bearer compare). OPTIONAL so the app
    // boots without a scheduler configured — the cron route stays inert (401) until set.
    CRON_SECRET: z.string().min(32).optional(), // generate: openssl rand -base64 48
    // P7b: Web Push (VAPID). ALL OPTIONAL — push is best-effort and the app runs fully with them
    // unset (sendPushToUserCore no-ops; the in-app notification row is always written).
    // Generate a keypair: npx web-push generate-vapid-keys
    VAPID_PUBLIC_KEY: z.string().min(1).optional(),
    VAPID_PRIVATE_KEY: z.string().min(1).optional(),
    VAPID_SUBJECT: z.string().min(1).default('mailto:admin@example.com'),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.url(),
    // P7b: VAPID public key, inlined into the client bundle at build (same value as VAPID_PUBLIC_KEY).
    // When unset the subscribe button hides and subscribeToPush() returns null.
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  },
  emptyStringAsUndefined: true,
  // DEVIATION: allow container builds (no secrets in the build context) to skip validation.
  // L-auth: scope the escape hatch to the BUILD phase only. Next sets NEXT_PHASE=phase-production-build
  // during `next build` (the docker image build, where secrets are absent). Requiring that phase means a
  // stray SKIP_ENV_VALIDATION in the RUNTIME environment can no longer silently bypass secret-strength
  // checks (BETTER_AUTH_SECRET/MCP_BEARER_TOKEN/CRON_SECRET .min(32), ADMIN_PASSWORD .min(16)).
  skipValidation:
    !!process.env.SKIP_ENV_VALIDATION && process.env.NEXT_PHASE === 'phase-production-build',
})
