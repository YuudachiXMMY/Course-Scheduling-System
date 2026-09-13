CREATE TABLE "calendar_feed" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"token" text NOT NULL,
	"teacher_id" text,
	"label" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_calendar_feed_tenant_id" ON "calendar_feed" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_calendar_feed_token" ON "calendar_feed" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_calendar_feed_tenant" ON "calendar_feed" USING btree ("tenant_id");