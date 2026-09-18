CREATE TABLE "section_share_link" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"section_id" text NOT NULL,
	"token" text NOT NULL,
	"label" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "section_share_link" ADD CONSTRAINT "fk_section_share_link_section" FOREIGN KEY ("tenant_id","section_id") REFERENCES "public"."class_section"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_section_share_link_tenant_id" ON "section_share_link" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_section_share_link_token" ON "section_share_link" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_section_share_link_active_section" ON "section_share_link" USING btree ("tenant_id","section_id") WHERE "section_share_link"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "idx_section_share_link_tenant_section" ON "section_share_link" USING btree ("tenant_id","section_id");