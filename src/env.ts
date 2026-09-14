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
    // P6-8: Claude MCP connector (static bearer). ALL OPTIONAL so the app boots without MCP
    // configured — the endpoint stays inert (401) and resolveMcpAuthContext fails fast until set.
    // The min-length constraints still apply WHEN a value is present.
    MCP_BEARER_TOKEN: z.string().min(32).optional(), // static bearer; generate: openssl rand -base64 48
    MCP_ORG_ID: z.string().min(1).optional(), // organizationId (=tenantId) the token acts as
    MCP_USER_ID: z.string().min(1).optional(), // user.id the token acts as (owner member row)
    MCP_RESOURCE_URL: z.url().optional(), // audience for withMcpAuth (anti confused-deputy)
  },
  client: { NEXT_PUBLIC_APP_URL: z.url() },
  experimental__runtimeEnv: { NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL },
  emptyStringAsUndefined: true,
  // DEVIATION: allow container builds (no secrets in the build context) to skip validation.
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
})
