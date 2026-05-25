CREATE TYPE "public"."classification" AS ENUM('fiyat', 'demo', 'ilgili', 'ilgisiz', 'oto_yanit', 'cikis');--> statement-breakpoint
CREATE TYPE "public"."kurum_tur" AS ENUM('muayenehane', 'poliklinik', 'hastane');--> statement-breakpoint
CREATE TYPE "public"."lead_durum" AS ENUM('aday', 'yeni', 'sekansta', 'cevap_geldi', 'demo_istedi', 'kazanildi', 'kaybedildi', 'cikti');--> statement-breakpoint
CREATE TYPE "public"."msg_dir" AS ENUM('out', 'in');--> statement-breakpoint
CREATE TYPE "public"."msg_status" AS ENUM('draft', 'approved', 'sent', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."segment" AS ENUM('solo', 'mid', 'hospital', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."seq_status" AS ENUM('active', 'paused', 'stopped_replied', 'stopped_optout', 'completed');--> statement-breakpoint
CREATE TYPE "public"."supp_reason" AS ENUM('optout', 'bounce', 'manual');--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid,
	"type" text NOT NULL,
	"payload_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kurum_adi" text NOT NULL,
	"sehir" text,
	"tur" "kurum_tur",
	"vet_sayisi" integer,
	"segment" "segment" DEFAULT 'unknown' NOT NULL,
	"tier" integer DEFAULT 1 NOT NULL,
	"email" text,
	"email_confidence" text,
	"website" text,
	"place_id" text,
	"phone" text,
	"instagram" text,
	"karar_verici" text,
	"kaynak" text,
	"durum" "lead_durum" DEFAULT 'aday' NOT NULL,
	"gmail_thread_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_place_id_unique" UNIQUE("place_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"direction" "msg_dir" NOT NULL,
	"gmail_message_id" text,
	"subject" text,
	"body" text,
	"classification" "classification",
	"status" "msg_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sequence_state" (
	"lead_id" uuid PRIMARY KEY NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"next_action_at" timestamp with time zone,
	"last_sent_at" timestamp with time zone,
	"status" "seq_status" DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppression" (
	"email" text PRIMARY KEY NOT NULL,
	"reason" "supp_reason" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_state" ADD CONSTRAINT "sequence_state_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_events_type" ON "events" USING btree ("type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_leads_email" ON "leads" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_leads_durum_tier" ON "leads" USING btree ("durum","tier");--> statement-breakpoint
CREATE INDEX "idx_messages_lead" ON "messages" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_seq_due" ON "sequence_state" USING btree ("status","next_action_at");