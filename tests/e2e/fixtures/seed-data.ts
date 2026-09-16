import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SEED_DATA_PATH, type E2ERole } from './seed-constants'

// Dynamic ids produced by scripts/seed-e2e.ts. Static identity (emails/password/token/names) lives
// in seed-constants.ts; this is only the stuff that does not exist until a seed has run.
export interface SeedData {
  seededAt: string
  tenantId: string
  baseURL: string
  accounts: Record<E2ERole, { email: string; userId: string; memberRole: string; landing: string }>
  studentA: { id: string; name: string }
  studentB: { id: string; name: string }
  course: { id: string; title: string }
  sectionA: { id: string; name: string; teacherId: string }
  sectionB: { id: string; name: string; teacherId: string }
  lessons: {
    sectionA: number
    sectionB: number
    // First lesson strictly in the future for each section (ISO strings; null if none in window).
    studentAFutureLessonId: string | null
    studentAFutureStartAt: string | null
    studentBFutureLessonId: string | null
    studentBFutureStartAt: string | null
  }
  share: { token: string; studentId: string; url: string }
  invalidShareToken: string
  // A pending reschedule_request (created by parentNoConsent for student B) for the dashboard
  // approval queue spec to act on. Its target slot is a conflict-free weekend time.
  pendingReschedule: {
    id: string
    studentId: string
    lessonId: string
    requestedStartAt: string
    requestedEndAt: string
  } | null
}

let cached: SeedData | null = null

/** Read the seed manifest written by global-setup's seed step. Throws a helpful error if missing. */
export function readSeedData(): SeedData {
  if (cached) return cached
  const path = resolve(process.cwd(), SEED_DATA_PATH)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    throw new Error(
      `E2E seed data not found at ${SEED_DATA_PATH}. It is produced by global-setup ` +
        `(npm run db:seed:e2e). Run \`npm run test:e2e\` (which triggers global-setup) rather than ` +
        `invoking playwright directly, or run \`npm run db:seed:e2e\` first.`,
    )
  }
  cached = JSON.parse(raw) as SeedData
  return cached
}
