ALTER TABLE "class_section" ALTER COLUMN "recurrence_timezone" SET DEFAULT 'America/Toronto';--> statement-breakpoint
-- Unify existing sections onto the app-wide zone. Stored lesson instants are UTC and unchanged;
-- this only re-anchors future recurrence materialization to America/Toronto wall-clock.
UPDATE "class_section" SET "recurrence_timezone" = 'America/Toronto' WHERE "recurrence_timezone" = 'Asia/Shanghai';
