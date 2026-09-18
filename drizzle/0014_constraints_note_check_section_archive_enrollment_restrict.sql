ALTER TABLE "enrollment" DROP CONSTRAINT "fk_enrollment_student";
--> statement-breakpoint
ALTER TABLE "enrollment" DROP CONSTRAINT "fk_enrollment_section";
--> statement-breakpoint
ALTER TABLE "class_section" ADD COLUMN "is_archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "fk_enrollment_student" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "fk_enrollment_section" FOREIGN KEY ("tenant_id","section_id") REFERENCES "public"."class_section"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_section_tenant_archived" ON "class_section" USING btree ("tenant_id","is_archived");--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "ck_note_target" CHECK ("note"."lesson_id" is not null or "note"."section_id" is not null or "note"."student_id" is not null);