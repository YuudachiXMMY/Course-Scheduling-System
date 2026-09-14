CREATE TYPE "public"."report_status" AS ENUM('draft', 'approved');--> statement-breakpoint
CREATE TABLE "progress_report" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" text NOT NULL,
	"section_id" text,
	"title" text,
	"period_start" date,
	"period_end" date,
	"narrative" text,
	"rubric_version" text NOT NULL,
	"model" text,
	"status" "report_status" DEFAULT 'draft' NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "progress_report" ADD CONSTRAINT "fk_report_student" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_report" ADD CONSTRAINT "fk_report_section" FOREIGN KEY ("tenant_id","section_id") REFERENCES "public"."class_section"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_report_tenant_id" ON "progress_report" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "idx_report_tenant_student" ON "progress_report" USING btree ("tenant_id","student_id");--> statement-breakpoint
CREATE INDEX "idx_report_tenant_status" ON "progress_report" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_report_tenant_section" ON "progress_report" USING btree ("tenant_id","section_id");