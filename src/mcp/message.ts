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
  shareUrl: string
}): string {
  const { studentName, lessons, shareUrl } = args
  const header = `${studentName} 近期课表：`
  if (lessons.length === 0) {
    return `${header}\n近期暂无排课。\n完整课表随时查看：${shareUrl}`
  }
  const lines = lessons.map((l) => {
    const s = DateTime.fromJSDate(l.startAt, { zone: 'utc' }).setZone(ZONE)
    const e = DateTime.fromJSDate(l.endAt, { zone: 'utc' }).setZone(ZONE)
    const loc = l.location ? ` · ${l.location}` : ''
    return `· ${s.toFormat('MM月dd日 EEE', { locale: 'zh' })} ${s.toFormat('HH:mm')}–${e.toFormat('HH:mm')} ${l.title ?? '课节'}${loc}`
  })
  return `${header}\n${lines.join('\n')}\n\n完整课表随时查看：${shareUrl}`
}
