DROP INDEX "idx_lesson_tenant_section";--> statement-breakpoint
CREATE INDEX "idx_lesson_tenant_section_start" ON "lesson" USING btree ("tenant_id","section_id","start_at");