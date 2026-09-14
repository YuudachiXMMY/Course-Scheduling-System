CREATE TYPE "public"."portal_relationship" AS ENUM('parent', 'student');--> statement-breakpoint
CREATE TABLE "portal_link" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" text NOT NULL,
	"user_id" text NOT NULL,
	"relationship" "portal_relationship" NOT NULL,
	"consented_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reschedule_request" ADD COLUMN "student_id" text;--> statement-breakpoint
ALTER TABLE "portal_link" ADD CONSTRAINT "fk_portal_link_student" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_portal_link_student_user" ON "portal_link" USING btree ("tenant_id","student_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_portal_link_tenant_user" ON "portal_link" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_portal_link_tenant_student" ON "portal_link" USING btree ("tenant_id","student_id");--> statement-breakpoint
ALTER TABLE "reschedule_request" ADD CONSTRAINT "fk_reschedule_student" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_reschedule_tenant_student" ON "reschedule_request" USING btree ("tenant_id","student_id");