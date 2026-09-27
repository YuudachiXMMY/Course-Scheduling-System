CREATE TABLE "section_teacher" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"section_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "section_teacher" ADD CONSTRAINT "fk_section_teacher_section" FOREIGN KEY ("tenant_id","section_id") REFERENCES "public"."class_section"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_section_teacher_tenant_id" ON "section_teacher" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_section_teacher_section_user" ON "section_teacher" USING btree ("tenant_id","section_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_section_teacher_tenant_user" ON "section_teacher" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_section_teacher_tenant_section" ON "section_teacher" USING btree ("tenant_id","section_id");--> statement-breakpoint
-- BACKFILL: mirror every section's existing primary teacher into the new access set so no teacher loses
-- access to a section they already teach. ON CONFLICT DO NOTHING makes this idempotent (safe to re-run)
-- and never crashes on an existing DB; NULL teacher_id sections (admin-only) simply insert no row.
INSERT INTO "section_teacher" ("id", "tenant_id", "section_id", "user_id")
SELECT gen_random_uuid()::text, "tenant_id", "id", "teacher_id"
FROM "class_section"
WHERE "teacher_id" IS NOT NULL
ON CONFLICT ("tenant_id", "section_id", "user_id") DO NOTHING;