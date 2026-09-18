import 'server-only'
import { chromium, type Browser } from 'playwright'
import { env } from '@/env'

// P4-5: memoized singleton browser. NEVER browser.close() per request — a resident browser
// + concurrency cap of 1 protects the small VPS (PRD risk).
let browserP: Promise<Browser> | null = null
async function getBrowser(): Promise<Browser> {
  // M1: a resident browser can crash/disconnect between requests. If the cached instance is dead,
  // drop it so we relaunch below — otherwise newContext() would throw on every subsequent export.
  if (browserP) {
    try {
      const b = await browserP
      if (b.isConnected()) return b
    } catch {
      // launch previously rejected (cached rejection) — fall through to relaunch.
    }
    browserP = null
  }
  // M1: launch() failures must NOT be cached as a permanent rejected promise. Reset browserP on
  // failure so a transient launch error (or missing system chromium) can be retried next request.
  const p = chromium.launch({
    headless: true,
    // SEC4: run Chromium WITH its OS sandbox by default (Playwright defaults chromiumSandbox to false,
    // so we must opt in explicitly). The sandbox is a real containment boundary for the renderer; we
    // only ever render app-generated, HTML-escaped markup via page.setContent and NEVER navigate to a
    // remote/user URL, but defence-in-depth is cheap here. If the target runtime cannot grant
    // unprivileged user namespaces (some hardened containers), set CHROMIUM_NO_SANDBOX=true to fall
    // back to the previous no-sandbox behavior — a documented, accepted risk (docs/adr/0002-*).
    chromiumSandbox: env.CHROMIUM_NO_SANDBOX !== 'true',
    // Debian system chromium in prod (/usr/bin/chromium via PLAYWRIGHT_CHROMIUM_PATH);
    // empty → Playwright's bundled Chromium in dev/macOS.
    executablePath: env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
    args: ['--disable-dev-shm-usage', '--disable-gpu'],
  })
  browserP = p
  try {
    return await p
  } catch (err) {
    if (browserP === p) browserP = null
    throw err
  }
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
