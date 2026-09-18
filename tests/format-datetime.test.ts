import { describe, it, expect } from 'vitest'
import { formatDateTime } from '@/lib/format-datetime'

// APP_TIME_ZONE is America/Toronto. All stored instants are UTC; the helper renders them as the
// Toronto wall-clock 'yyyy-MM-dd HH:mm'. These fixtures pin both DST offsets:
//   2026-01-15T13:30Z → EST (UTC-5) → 08:30
//   2026-07-15T13:30Z → EDT (UTC-4) → 09:30
describe('formatDateTime', () => {
  it('formats a JS Date (business-table mode:date) in America/Toronto', () => {
    // EST: UTC-5 → 13:30 - 5h = 08:30
    expect(formatDateTime(new Date('2026-01-15T13:30:00Z'))).toBe('2026-01-15 08:30')
    // EDT: UTC-4 → 13:30 - 4h = 09:30
    expect(formatDateTime(new Date('2026-07-15T13:30:00Z'))).toBe('2026-07-15 09:30')
  })

  it('formats an ISO string (auth-table timestamp, no drizzle mode) in America/Toronto', () => {
    expect(formatDateTime('2026-01-15T13:30:00Z')).toBe('2026-01-15 08:30')
    expect(formatDateTime('2026-07-15T13:30:00.000Z')).toBe('2026-07-15 09:30')
  })

  it('renders an em dash for null / undefined', () => {
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime(undefined)).toBe('—')
  })
})
