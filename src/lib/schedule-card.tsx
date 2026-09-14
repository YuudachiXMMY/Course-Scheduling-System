import { renderToStaticMarkup } from 'react-dom/server'
import { DateTime } from 'luxon'

const ZONE = 'Asia/Shanghai'

export interface CardLesson {
  id: string
  title: string | null
  startAt: Date
  endAt: Date
  location: string | null
}

export interface CardData {
  studentName: string
  subtitle?: string
  qrDataUrl?: string
  shareUrl?: string
  lessons: CardLesson[]
  note?: string
}

// Lessons are UTC instants → always setZone(Asia/Shanghai) before formatting (mirror ical-feed's Luxon note).
function fmt(d: Date) {
  return DateTime.fromJSDate(d, { zone: 'utc' }).setZone(ZONE)
}

// P4-3: inline style objects ONLY — Tailwind classes do NOT apply under Playwright setContent
// (no served stylesheet). This same component renders identically in the RSC public page and in
// the PNG pipeline (renderScheduleCardHtml → setContent).
export function ScheduleCard({ data }: { data: CardData }) {
  const rows = data.lessons.slice(0, 12) // PNG cap; web page shows all (see Task 5)
  return (
    <div
      id="card"
      style={{
        width: 720,
        boxSizing: 'border-box',
        padding: 32,
        background: '#ffffff',
        fontFamily: "'Noto Sans SC', system-ui, sans-serif",
        color: '#171717',
      }}
    >
      <div style={{ fontSize: 30, fontWeight: 700 }}>{data.studentName} 的课表</div>
      {data.subtitle && (
        <div style={{ fontSize: 18, color: '#525252', marginTop: 4 }}>{data.subtitle}</div>
      )}
      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.length === 0 && (
          <div style={{ fontSize: 20, color: '#737373' }}>近期暂无排课</div>
        )}
        {rows.map((l) => {
          const s = fmt(l.startAt)
          const e = fmt(l.endAt)
          return (
            <div
              key={l.id}
              style={{
                display: 'flex',
                gap: 16,
                fontSize: 22,
                borderBottom: '1px solid #e5e5e5',
                paddingBottom: 10,
              }}
            >
              <div style={{ minWidth: 210, fontWeight: 600 }}>
                {s.toFormat('MM月dd日 EEE', { locale: 'zh' })}
              </div>
              <div style={{ minWidth: 130 }}>
                {s.toFormat('HH:mm')}–{e.toFormat('HH:mm')}
              </div>
              <div style={{ flex: 1 }}>
                {l.title ?? '课节'}
                {l.location ? ` · ${l.location}` : ''}
              </div>
            </div>
          )
        })}
        {data.lessons.length > rows.length && (
          <div style={{ fontSize: 18, color: '#737373' }}>
            +{data.lessons.length - rows.length} 节更多，请扫码查看完整课表
          </div>
        )}
      </div>
      {data.qrDataUrl && (
        <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={data.qrDataUrl} width={132} height={132} alt="扫码查看课表" />
          <div style={{ fontSize: 16, color: '#525252' }}>微信扫码查看/收藏完整课表</div>
        </div>
      )}
    </div>
  )
}

// PURE — no DB, no Playwright. Wrap in a self-contained doc with a CJK font-family block (P4-3).
// The Debian runtime image supplies the 'Noto Sans SC' font file (fonts-noto-cjk).
export function renderScheduleCardHtml(data: CardData): string {
  const body = renderToStaticMarkup(<ScheduleCard data={data} />)
  return `<!doctype html><html lang="zh-Hans"><head><meta charset="utf-8">
      <style>*{margin:0;padding:0}body{font-family:'Noto Sans SC',system-ui,sans-serif}</style>
      </head><body>${body}</body></html>`
}
