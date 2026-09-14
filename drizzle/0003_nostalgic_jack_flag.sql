CREATE TABLE "share_link" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" text NOT NULL,
	"token" text NOT NULL,
	"label" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "share_link" ADD CONSTRAINT "fk_share_link_student" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_share_link_tenant_id" ON "share_link" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_share_link_token" ON "share_link" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_share_link_active_student" ON "share_link" USING btree ("tenant_id","student_id") WHERE "share_link"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "idx_share_link_tenant_student" ON "share_link" USING btree ("tenant_id","student_id");