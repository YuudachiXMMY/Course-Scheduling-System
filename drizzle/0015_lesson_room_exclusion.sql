-- DB2 — room double-booking prevention. Custom migration: Drizzle has no EXCLUDE builder (mirrors
-- 0001_lesson_teacher_exclusion). btree_gist (enabled in 0001) lets us mix `text WITH =` and
-- `tstzrange WITH &&` in one GiST exclusion constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "lesson"
  ADD CONSTRAINT "lesson_no_room_overlap"
  EXCLUDE USING gist (
    "tenant_id" WITH =,
    "location"  WITH =,
    tstzrange("start_at", "end_at", '[)') WITH &&
  )
  WHERE (status <> 'canceled' AND location IS NOT NULL);
-- NOTE: NULL location is exempt (no room assigned). location is free-form text, so 'Room A' vs 'room a'
-- do NOT collide (false negatives are accepted — there is no room entity to normalize against). '[)'
-- lets back-to-back lessons in the same room touch without overlapping.
