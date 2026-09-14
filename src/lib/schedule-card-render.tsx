import { ScheduleCard, type CardData } from './schedule-card'

// P4-3: PNG-only render path, kept SEPARATE from schedule-card.tsx (that component is also imported
// by the RSC public page /s/[token]/page.tsx).
//
// Next 16 / Turbopack rejects ANY module in the App graph that STATICALLY imports react-dom/server
// while also importing a component ("You're importing a component that imports react-dom/server"),
// even from a route handler where server-side rendering to a string is perfectly valid. A dynamic
// import() is a runtime edge the static check doesn't follow, so we defer react-dom/server to call
// time. This makes renderScheduleCardHtml async — callers already await it in async route handlers.
//
// PURE — no DB, no Playwright. Wraps in a self-contained doc with a CJK font-family block (P4-3).
// The Debian runtime image supplies the 'Noto Sans SC' font file (fonts-noto-cjk).
export async function renderScheduleCardHtml(data: CardData): Promise<string> {
  const { renderToStaticMarkup } = await import('react-dom/server')
  const body = renderToStaticMarkup(<ScheduleCard data={data} />)
  return `<!doctype html><html lang="zh-Hans"><head><meta charset="utf-8">
      <style>*{margin:0;padding:0}body{font-family:'Noto Sans SC',system-ui,sans-serif}</style>
      </head><body>${body}</body></html>`
}
