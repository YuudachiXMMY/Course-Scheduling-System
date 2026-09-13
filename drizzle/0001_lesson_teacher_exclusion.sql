-- Custom migration — Drizzle has no EXCLUDE builder (P2-3/P2-4).
-- btree_gist lets us mix `text WITH =` and `tstzrange WITH &&` in one GiST exclusion constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "lesson"
  ADD CONSTRAINT "lesson_no_teacher_overlap"
  EXCLUDE USING gist (
    "tenant_id"  WITH =,
    "teacher_id" WITH =,
    tstzrange("start_at", "end_at", '[)') WITH &&
  )
  WHERE (status <> 'canceled');
-- NOTE: rows with NULL teacher_id are exempt (NULL never = NULL) — always denormalize section.teacherId
-- onto lesson.teacherId at materialization so recurring lessons are covered. '[)' lets back-to-back touch.
