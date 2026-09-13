CREATE TYPE "public"."attendance_status" AS ENUM('present', 'absent', 'late', 'excused');--> statement-breakpoint
CREATE TYPE "public"."enrollment_status" AS ENUM('active', 'dropped', 'completed');--> statement-breakpoint
CREATE TYPE "public"."lesson_status" AS ENUM('scheduled', 'completed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."note_visibility" AS ENUM('internal', 'shared');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'paid', 'refunded', 'void');--> statement-breakpoint
CREATE TYPE "public"."reschedule_status" AS ENUM('pending', 'approved', 'rejected', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."student_status" AS ENUM('active', 'inactive', 'archived');--> statement-breakpoint
CREATE TABLE "student" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"english_name" text,
	"parent_name" text,
	"parent_phone" text,
	"parent_wechat" text,
	"parent_email" text,
	"school_grade" text,
	"school" text,
	"birth_date" date,
	"status" "student_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "class_section" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"course_id" text NOT NULL,
	"name" text,
	"teacher_id" text,
	"capacity" integer DEFAULT 1 NOT NULL,
	"term_start_date" date,
	"term_end_date" date,
	"rrule" text,
	"recurrence_dtstart" timestamp with time zone,
	"recurrence_timezone" text DEFAULT 'Asia/Shanghai' NOT NULL,
	"default_duration_minutes" integer,
	"default_location" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_section_capacity" CHECK ("class_section"."capacity" between 1 and 15)
);
--> statement-breakpoint
CREATE TABLE "course" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"title" text NOT NULL,
	"subject" text,
	"description" text,
	"level" text,
	"default_duration_minutes" integer DEFAULT 60 NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrollment" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" text NOT NULL,
	"section_id" text NOT NULL,
	"status" "enrollment_status" DEFAULT 'active' NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dropped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lesson" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"section_id" text NOT NULL,
	"teacher_id" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"status" "lesson_status" DEFAULT 'scheduled' NOT NULL,
	"location" text,
	"title" text,
	"notes" text,
	"is_exception" boolean DEFAULT false NOT NULL,
	"original_start_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_lesson_time_order" CHECK ("lesson"."end_at" > "lesson"."start_at")
);
--> statement-breakpoint
CREATE TABLE "attendance" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"lesson_id" text NOT NULL,
	"student_id" text NOT NULL,
	"status" "attendance_status" DEFAULT 'present' NOT NULL,
	"note" text,
	"recorded_by" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grade" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" text NOT NULL,
	"lesson_id" text,
	"section_id" text,
	"title" text,
	"score" numeric(6, 2),
	"max_score" numeric(6, 2),
	"rubric" jsonb,
	"comment" text,
	"graded_by" text,
	"graded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_grade_target" CHECK ("grade"."lesson_id" is not null or "grade"."section_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "note" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"lesson_id" text,
	"section_id" text,
	"student_id" text,
	"author_id" text,
	"body" text NOT NULL,
	"visibility" "note_visibility" DEFAULT 'internal' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_package" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" text NOT NULL,
	"name" text,
	"total_credits" integer,
	"remaining_credits" integer,
	"price_cents" integer,
	"currency" text DEFAULT 'CNY' NOT NULL,
	"purchased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" text NOT NULL,
	"credit_package_id" text,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'CNY' NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"method" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reschedule_request" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"lesson_id" text NOT NULL,
	"requested_by_id" text,
	"requested_start_at" timestamp with time zone,
	"requested_end_at" timestamp with time zone,
	"reason" text,
	"status" "reschedule_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by_id" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	"impersonated_by" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_student_tenant_id" ON "student" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "idx_student_tenant_status" ON "student" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_student_tenant_name" ON "student" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_section_tenant_id" ON "class_section" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "idx_section_tenant_course" ON "class_section" USING btree ("tenant_id","course_id");--> statement-breakpoint
CREATE INDEX "idx_section_tenant_teacher" ON "class_section" USING btree ("tenant_id","teacher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_course_tenant_id" ON "course" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "idx_course_tenant" ON "course" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_enrollment_student_section" ON "enrollment" USING btree ("tenant_id","student_id","section_id") WHERE "enrollment"."status" = 'active';--> statement-breakpoint
CREATE INDEX "idx_enrollment_tenant_section" ON "enrollment" USING btree ("tenant_id","section_id");--> statement-breakpoint
CREATE INDEX "idx_enrollment_tenant_student" ON "enrollment" USING btree ("tenant_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lesson_tenant_id" ON "lesson" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lesson_section_slot" ON "lesson" USING btree ("tenant_id","section_id","original_start_at");--> statement-breakpoint
CREATE INDEX "idx_lesson_teacher_time" ON "lesson" USING btree ("tenant_id","teacher_id","start_at");--> statement-breakpoint
CREATE INDEX "idx_lesson_time_range" ON "lesson" USING btree ("tenant_id","start_at","end_at");--> statement-breakpoint
CREATE INDEX "idx_lesson_room_time" ON "lesson" USING btree ("tenant_id","location","start_at");--> statement-breakpoint
CREATE INDEX "idx_lesson_tenant_section" ON "lesson" USING btree ("tenant_id","section_id");--> statement-breakpoint
CREATE INDEX "idx_lesson_tenant_status" ON "lesson" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_attendance_lesson_student" ON "attendance" USING btree ("tenant_id","lesson_id","student_id");--> statement-breakpoint
CREATE INDEX "idx_attendance_tenant_student" ON "attendance" USING btree ("tenant_id","student_id");--> statement-breakpoint
CREATE INDEX "idx_grade_tenant_student" ON "grade" USING btree ("tenant_id","student_id");--> statement-breakpoint
CREATE INDEX "idx_grade_tenant_lesson" ON "grade" USING btree ("tenant_id","lesson_id");--> statement-breakpoint
CREATE INDEX "idx_grade_tenant_section" ON "grade" USING btree ("tenant_id","section_id");--> statement-breakpoint
CREATE INDEX "idx_note_tenant_lesson" ON "note" USING btree ("tenant_id","lesson_id");--> statement-breakpoint
CREATE INDEX "idx_note_tenant_student" ON "note" USING btree ("tenant_id","student_id");--> statement-breakpoint
CREATE INDEX "idx_note_tenant_section" ON "note" USING btree ("tenant_id","section_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_credit_tenant_id" ON "credit_package" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "idx_credit_tenant_student" ON "credit_package" USING btree ("tenant_id","student_id");--> statement-breakpoint
CREATE INDEX "idx_payment_tenant_student" ON "payment" USING btree ("tenant_id","student_id");--> statement-breakpoint
CREATE INDEX "idx_payment_tenant_credit" ON "payment" USING btree ("tenant_id","credit_package_id");--> statement-breakpoint
CREATE INDEX "idx_reschedule_tenant_status" ON "reschedule_request" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_reschedule_tenant_lesson" ON "reschedule_request" USING btree ("tenant_id","lesson_id");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
ALTER TABLE "class_section" ADD CONSTRAINT "fk_section_course" FOREIGN KEY ("tenant_id","course_id") REFERENCES "public"."course"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "fk_enrollment_student" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "fk_enrollment_section" FOREIGN KEY ("tenant_id","section_id") REFERENCES "public"."class_section"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "fk_lesson_section" FOREIGN KEY ("tenant_id","section_id") REFERENCES "public"."class_section"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "fk_attendance_lesson" FOREIGN KEY ("tenant_id","lesson_id") REFERENCES "public"."lesson"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "fk_attendance_student" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade" ADD CONSTRAINT "fk_grade_student" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade" ADD CONSTRAINT "fk_grade_lesson" FOREIGN KEY ("tenant_id","lesson_id") REFERENCES "public"."lesson"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade" ADD CONSTRAINT "fk_grade_section" FOREIGN KEY ("tenant_id","section_id") REFERENCES "public"."class_section"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "fk_note_lesson" FOREIGN KEY ("tenant_id","lesson_id") REFERENCES "public"."lesson"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "fk_note_section" FOREIGN KEY ("tenant_id","section_id") REFERENCES "public"."class_section"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "fk_note_student" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_package" ADD CONSTRAINT "fk_credit_student" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "fk_payment_student" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."student"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "fk_payment_credit" FOREIGN KEY ("tenant_id","credit_package_id") REFERENCES "public"."credit_package"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reschedule_request" ADD CONSTRAINT "fk_reschedule_lesson" FOREIGN KEY ("tenant_id","lesson_id") REFERENCES "public"."lesson"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;