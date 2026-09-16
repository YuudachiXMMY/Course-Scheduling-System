// Shared, serializable types crossing the Server Component → Client Component boundary.
// No 'server-only' import here — the client calendar imports these too.
import type { ConflictSummary } from '@/lib/conflict'

export interface CalendarEvent {
  id: string
  title: string
  start: string // ISO UTC instant
  end: string // ISO UTC instant
  sectionId: string
  status: 'scheduled' | 'completed' | 'canceled'
  courseTitle?: string | null // parent course name, for the calendar event label
  studentNames?: string[] // active-enrolled students of the section, for the calendar event label
  location?: string | null
  meetingUrl?: string | null // online-class link (Zoom/腾讯会议)
}

export type ScheduleResult =
  | { ok: true; event: CalendarEvent }
  | {
      ok: false
      error: 'CONFLICT'
      conflicts: Pick<ConflictSummary, 'id' | 'title'>[]
      suggestions: string[] // 'HH:mm' local (America/Toronto)
    }
