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
  },
  client: { NEXT_PUBLIC_APP_URL: z.url() },
  experimental__runtimeEnv: { NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL },
  emptyStringAsUndefined: true,
  // DEVIATION: allow container builds (no secrets in the build context) to skip validation.
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
})
