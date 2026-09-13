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
}

export type ScheduleResult =
  | { ok: true; event: CalendarEvent }
  | {
      ok: false
      error: 'CONFLICT'
      conflicts: Pick<ConflictSummary, 'id' | 'title'>[]
      suggestions: string[] // 'HH:mm' local (Asia/Shanghai)
    }
