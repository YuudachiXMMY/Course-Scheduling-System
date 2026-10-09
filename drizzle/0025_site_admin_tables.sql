CREATE TABLE "contact_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"message" text,
	"subscribe" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locale" text,
	"grade" integer,
	"programs" text[] DEFAULT '{}' NOT NULL,
	"topic" text,
	"source" text,
	"status" text DEFAULT 'new' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "email_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"email" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "popups" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"button_text" text,
	"button_link" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"display_rules" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscribers" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"subscribed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "fk_email_deliveries_campaign" FOREIGN KEY ("campaign_id") REFERENCES "public"."email_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_contact_messages_created_at" ON "contact_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_contact_messages_status" ON "contact_messages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_email_campaigns_created_at" ON "email_campaigns" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_email_deliveries_campaign_email" ON "email_deliveries" USING btree ("campaign_id","email");--> statement-breakpoint
CREATE INDEX "idx_email_deliveries_campaign" ON "email_deliveries" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_popups_active_created_at" ON "popups" USING btree ("is_active","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_subscribers_email" ON "subscribers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_subscribers_status" ON "subscribers" USING btree ("status");