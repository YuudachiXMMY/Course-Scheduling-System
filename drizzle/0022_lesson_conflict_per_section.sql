-- Scope conflict detection to a SINGLE CLASS (section). Previously a teacher (0001) or a room (0015)
-- could not be double-booked ANYWHERE in the tenant; now the same teacher / room may hold overlapping
-- lessons in DIFFERENT sections, and only WITHIN one section do overlaps still collide. Add "section_id"
-- to both GiST exclusion keys. Custom migration: Drizzle has no EXCLUDE builder (mirrors 0001 / 0015).
--
-- Relaxing (not tightening) the keys: every row that satisfied the old, stricter constraints also
-- satisfies these, so ADD CONSTRAINT never fails to validate existing data and can't crash-loop a boot.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "lesson" DROP CONSTRAINT IF EXISTS "lesson_no_teacher_overlap";--> statement-breakpoint
ALTER TABLE "lesson"
  ADD CONSTRAINT "lesson_no_teacher_overlap"
  EXCLUDE USING gist (
    "tenant_id"  WITH =,
    "section_id" WITH =,
    "teacher_id" WITH =,
    tstzrange("start_at", "end_at", '[)') WITH &&
  )
  WHERE (status <> 'canceled');
--> statement-breakpoint
ALTER TABLE "lesson" DROP CONSTRAINT IF EXISTS "lesson_no_room_overlap";--> statement-breakpoint
ALTER TABLE "lesson"
  ADD CONSTRAINT "lesson_no_room_overlap"
  EXCLUDE USING gist (
    "tenant_id"  WITH =,
    "section_id" WITH =,
    "location"   WITH =,
    tstzrange("start_at", "end_at", '[)') WITH &&
  )
  WHERE (status <> 'canceled' AND location IS NOT NULL);
-- NOTE: rows with NULL teacher_id / NULL location remain exempt (NULL never = NULL). section_id is NOT
-- NULL on lesson, so every row participates in the section dimension. '[)' still lets back-to-back touch.
