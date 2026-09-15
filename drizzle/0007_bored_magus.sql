CREATE TABLE "section_meeting" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"section_id" text NOT NULL,
	"by_day" text NOT NULL,
	"start_time" text NOT NULL,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "class_section" ADD COLUMN "default_meeting_url" text;--> statement-breakpoint
ALTER TABLE "lesson" ADD COLUMN "meeting_url" text;--> statement-breakpoint
ALTER TABLE "section_meeting" ADD CONSTRAINT "fk_meeting_section" FOREIGN KEY ("tenant_id","section_id") REFERENCES "public"."class_section"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_meeting_tenant_id" ON "section_meeting" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "idx_meeting_tenant_section" ON "section_meeting" USING btree ("tenant_id","section_id");