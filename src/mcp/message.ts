import { DateTime } from 'luxon'
import type { FeedLesson } from '@/lib/ical-feed'

// P6-6: PURE composer for draft_parent_message (no DB, no server-only) so it is directly
// unit-testable. Formats a student's upcoming lessons (UTC instants → Asia/Shanghai wall-clock)
// plus the read-only share URL into a WeChat-ready Chinese draft. The tutor reviews and sends it
// manually — this returns text only, nothing is sent.

const ZONE = 'Asia/Shanghai'

export function composeParentMessage(args: {
  studentName: string
  lessons: FeedLesson[]
  // Optional: draft_parent_message no longer mints a share on the fly (PR#7 M-1), so a student
  // may have no active link. When absent, the share line is omitted — the parent text stays clean.
  shareUrl?: string | null
}): string {
  const { studentName, lessons, shareUrl } = args
  const header = `${studentName} 近期课表：`
  const link = shareUrl ? `完整课表随时查看：${shareUrl}` : ''
  if (lessons.length === 0) {
    return link ? `${header}\n近期暂无排课。\n${link}` : `${header}\n近期暂无排课。`
  }
  const lines = lessons.map((l) => {
    const s = DateTime.fromJSDate(l.startAt, { zone: 'utc' }).setZone(ZONE)
    const e = DateTime.fromJSDate(l.endAt, { zone: 'utc' }).setZone(ZONE)
    const loc = l.location ? ` · ${l.location}` : ''
    return `· ${s.toFormat('MM月dd日 EEE', { locale: 'zh' })} ${s.toFormat('HH:mm')}–${e.toFormat('HH:mm')} ${l.title ?? '课节'}${loc}`
  })
  const body = `${header}\n${lines.join('\n')}`
  return link ? `${body}\n\n${link}` : body
}
