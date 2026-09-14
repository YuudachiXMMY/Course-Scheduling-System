import 'server-only'
import { chromium, type Browser } from 'playwright'
import { env } from '@/env'

// P4-5: memoized singleton browser. NEVER browser.close() per request — a resident browser
// + concurrency cap of 1 protects the small VPS (PRD risk).
let browserP: Promise<Browser> | null = null
function getBrowser(): Promise<Browser> {
  if (!browserP) {
    browserP = chromium.launch({
      headless: true,
      chromiumSandbox: false,
      // Debian system chromium in prod (/usr/bin/chromium via PLAYWRIGHT_CHROMIUM_PATH);
      // empty → Playwright's bundled Chromium in dev/macOS.
      executablePath: env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
      args: ['--disable-dev-shm-usage', '--disable-gpu'],
    })
  }
  return browserP
}

// Small VPS guard (PRD risk): serialize screenshots through one browser.
let queue: Promise<unknown> = Promise.resolve()
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => {})
  return run
}

export function renderCardPng(html: string): Promise<Buffer> {
  return withLock(async () => {
    const browser = await getBrowser()
    const context = await browser.newContext({ deviceScaleFactor: 2 })
    try {
      const page = await context.newPage()
      await page.setContent(html, { waitUntil: 'domcontentloaded' })
      await page.evaluate(() => document.fonts.ready) // CJK belt-and-suspenders (Playwright also awaits internally)
      return await page.locator('#card').screenshot({ type: 'png' })
    } finally {
      await context.close() // close context, KEEP the browser resident
    }
  })
}
