-- DB1 — enforce referential integrity on tenant_id. Custom migration: tenant_id === Better Auth
-- organizationId, kept as bare text in the _helpers.tenantId() spine (auth owns the organization
-- table). Adding .references() in the helper would force a helper->auth-schema import + one uniform
-- onDelete, so the FK is declared here per app table instead. ON DELETE RESTRICT (NOT cascade):
-- cascading an org delete would mass-purge tenant data AND bypass the H1 retention FKs on
-- grade/payment/attendance (Postgres cascades top-down) — prefer an explicit purge routine.
-- Covers ALL 18 app tables that carry tenant_id (includes class_section & section_meeting).
-- Pre-existing rows whose tenant_id has no matching organization would block these ALTERs — run
-- scripts/cleanup-orphan-tenants.ts first.
ALTER TABLE "attendance" ADD CONSTRAINT "fk_attendance_tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "calendar_feed" ADD CONSTRAINT "fk_calendar_feed_tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "class_section" ADD CONSTRAINT "fk_class_section_tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "fk_course_tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "credit_package" ADD CONSTRAINT "fk_credit_package_tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "fk_enrollment_tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "grade" ADD CONSTRAINT "fk_grade_tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "fk_lesson_tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "fk_note_tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "fk_notification_tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "fk_payment_tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "portal_link" ADD CONSTRAINT "fk_portal_link_tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "progress_report" ADD CONSTRAINT "fk_progress_report_tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "fk_push_subscription_tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "reschedule_request" ADD CONSTRAINT "fk_reschedule_request_tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "section_meeting" ADD CONSTRAINT "fk_section_meeting_tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "share_link" ADD CONSTRAINT "fk_share_link_tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "fk_student_tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE restrict;
