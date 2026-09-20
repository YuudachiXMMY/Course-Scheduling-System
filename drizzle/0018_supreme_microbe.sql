ALTER TABLE "calendar_feed" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "share_link" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "section_share_link" ADD COLUMN "expires_at" timestamp with time zone;