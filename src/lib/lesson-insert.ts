import 'server-only'
import { db } from '@/db'
import { lesson } from '@/db/schema'
import { isExclusionViolation } from './errors'
import type { MaterializeResult } from './materialize'

// Bulk-insert lesson rows keyed on (tenant, section, original_start_at), skipping duplicates via
// ON CONFLICT DO NOTHING so re-inserting an existing slot is a no-op (counted as 0 inserted). A batch
// that overlaps EXISTING lessons can itself trip the teacher/room GiST exclusion (23P01) — fall back to
// per-occurrence inserts so good slots still land and conflicting ones are counted as `conflicts`
// rather than aborting the whole batch (P2-7 GOTCHA).
//
// Shared by materialize.ts (the canonical section grid) and add-sessions.ts (ad-hoc 排课 additions):
// each builds its OWN row set (e.g. add-sessions marks rows isException:true, materialize does not) and
// passes them in, so this helper owns ONLY the conflict-tolerant insert, never the row construction.
export async function insertLessonsWithConflictFallback(
  rows: (typeof lesson.$inferInsert)[],
): Promise<MaterializeResult> {
  const target = [lesson.tenantId, lesson.sectionId, lesson.originalStartAt]

  try {
    const res = await db
      .insert(lesson)
      .values(rows)
      .onConflictDoNothing({ target })
      .returning({ id: lesson.id })
    return { inserted: res.length, conflicts: 0 }
  } catch (e) {
    if (!isExclusionViolation(e)) throw e
    let inserted = 0
    let conflicts = 0
    for (const row of rows) {
      try {
        const res = await db
          .insert(lesson)
          .values(row)
          .onConflictDoNothing({ target })
          .returning({ id: lesson.id })
        inserted += res.length
      } catch (inner) {
        if (isExclusionViolation(inner)) conflicts += 1
        else throw inner
      }
    }
    return { inserted, conflicts }
  }
}
