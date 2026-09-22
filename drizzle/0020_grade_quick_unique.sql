-- F5 — backstop the quick-grade upsert (src/app/dashboard/teach/[sectionId]/data.ts). Its
-- select-then-write on (lesson, student, title) has no lock/tx, so two concurrent writes could both
-- INSERT → duplicate rows that report-stats double-counts into the parent PDF average. A partial UNIQUE
-- index makes a race raise 23505 (the upsert converts it to an UPDATE) instead of silently duplicating.
--
-- IMPORTANT (F4 lesson): an EXISTING prod DB may ALREADY hold such duplicate rows (that is the bug), so
-- creating the unique index bare would fail and crash-loop the migrate step. Dedup FIRST — keep the most
-- recently graded row per (tenant, lesson, student, title), delete the rest — then create the index.
-- Idempotent: the dedup is a no-op once unique, and CREATE UNIQUE INDEX IF NOT EXISTS is re-runnable.
DELETE FROM "grade" g
USING "grade" keep
WHERE g."tenant_id" = keep."tenant_id"
  AND g."lesson_id" = keep."lesson_id"
  AND g."student_id" = keep."student_id"
  AND g."title" = keep."title"
  AND g."lesson_id" IS NOT NULL
  AND g."title" IS NOT NULL
  AND (
    COALESCE(keep."graded_at", keep."created_at") > COALESCE(g."graded_at", g."created_at")
    OR (
      COALESCE(keep."graded_at", keep."created_at") = COALESCE(g."graded_at", g."created_at")
      AND keep."id" > g."id"
    )
  );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_grade_lesson_student_title"
  ON "grade" ("tenant_id", "lesson_id", "student_id", "title")
  WHERE "lesson_id" IS NOT NULL AND "title" IS NOT NULL;
