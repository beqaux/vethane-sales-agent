CREATE TYPE "public"."pending_action_kind" AS ENUM('send_draft', 'cancel_draft', 'confirm_demo_time');--> statement-breakpoint
CREATE TYPE "public"."pending_action_status" AS ENUM('pending', 'resolved', 'expired', 'cancelled');--> statement-breakpoint
CREATE TABLE "pending_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "pending_action_kind" NOT NULL,
	"lead_id" uuid NOT NULL,
	"gmail_draft_id" text,
	"gmail_thread_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "pending_action_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_pending_status_expires" ON "pending_actions" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "idx_pending_lead" ON "pending_actions" USING btree ("lead_id");