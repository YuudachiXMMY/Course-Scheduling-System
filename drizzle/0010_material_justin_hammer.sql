CREATE TYPE "public"."notification_type" AS ENUM('lesson_reminder', 'reschedule_approved', 'reschedule_rejected');--> statement-breakpoint
CREATE TABLE "notification" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"url" text,
	"lesson_id" text,
	"student_id" text,
	"dedupe_key" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "fk_notification_lesson" FOREIGN KEY ("tenant_id","lesson_id") REFERENCES "public"."lesson"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "fk_notification_student" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_notification_dedupe" ON "notification" USING btree ("tenant_id","dedupe_key") WHERE "notification"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "idx_notification_tenant_user" ON "notification" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_notification_tenant_user_read" ON "notification" USING btree ("tenant_id","user_id","read_at");--> statement-breakpoint
CREATE INDEX "idx_notification_tenant_lesson" ON "notification" USING btree ("tenant_id","lesson_id");--> statement-breakpoint
CREATE INDEX "idx_notification_tenant_student" ON "notification" USING btree ("tenant_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_push_sub_tenant_endpoint" ON "push_subscription" USING btree ("tenant_id","endpoint");--> statement-breakpoint
CREATE INDEX "idx_push_sub_tenant_user" ON "push_subscription" USING btree ("tenant_id","user_id");