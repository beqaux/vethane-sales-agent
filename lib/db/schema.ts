import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  SEGMENTS,
  KURUM_TURLERI,
  LEAD_DURUMLARI,
  SEQ_STATUSES,
  MSG_DIRECTIONS,
  CLASSIFICATIONS,
  MSG_STATUSES,
  SUPP_REASONS,
  PENDING_ACTION_KINDS,
  PENDING_ACTION_STATUSES,
} from "../domain/enums";

// E-postalar yazımda küçük-harfe normalize edilir (citext yerine) → unique index case-insensitive davranır.

export const segmentEnum = pgEnum("segment", SEGMENTS);
export const kurumTurEnum = pgEnum("kurum_tur", KURUM_TURLERI);
export const leadDurumEnum = pgEnum("lead_durum", LEAD_DURUMLARI);
export const seqStatusEnum = pgEnum("seq_status", SEQ_STATUSES);
export const msgDirEnum = pgEnum("msg_dir", MSG_DIRECTIONS);
export const classificationEnum = pgEnum("classification", CLASSIFICATIONS);
export const msgStatusEnum = pgEnum("msg_status", MSG_STATUSES);
export const suppReasonEnum = pgEnum("supp_reason", SUPP_REASONS);
export const pendingActionKindEnum = pgEnum("pending_action_kind", PENDING_ACTION_KINDS);
export const pendingActionStatusEnum = pgEnum("pending_action_status", PENDING_ACTION_STATUSES);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kurumAdi: text("kurum_adi").notNull(),
    alternateEmails: text("alternate_emails").array().notNull().default([]),
    sehir: text("sehir"),
    tur: kurumTurEnum("tur"),
    vetSayisi: integer("vet_sayisi"),
    segment: segmentEnum("segment").notNull().default("unknown"),
    tier: integer("tier").notNull().default(1),
    email: text("email"),
    emailConfidence: text("email_confidence"),
    website: text("website"),
    placeId: text("place_id").unique(),
    phone: text("phone"),
    instagram: text("instagram"),
    kararVerici: text("karar_verici"),
    kaynak: text("kaynak"),
    durum: leadDurumEnum("durum").notNull().default("aday"),
    gmailThreadId: text("gmail_thread_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_leads_email").on(t.email),
    index("idx_leads_durum_tier").on(t.durum, t.tier),
  ],
);

export const sequenceState = pgTable(
  "sequence_state",
  {
    leadId: uuid("lead_id")
      .primaryKey()
      .references(() => leads.id, { onDelete: "cascade" }),
    currentStep: integer("current_step").notNull().default(0),
    nextActionAt: timestamp("next_action_at", { withTimezone: true }),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    status: seqStatusEnum("status").notNull().default("active"),
  },
  (t) => [index("idx_seq_due").on(t.status, t.nextActionAt)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    direction: msgDirEnum("direction").notNull(),
    gmailMessageId: text("gmail_message_id"),
    subject: text("subject"),
    body: text("body"),
    classification: classificationEnum("classification"),
    status: msgStatusEnum("status"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_messages_lead").on(t.leadId, t.createdAt),
    // Pub/Sub at-least-once delivery'ye karşı race-safe dedup: aynı gmailMessageId
    // 'in' direction'da bir kez insert edilebilir; ikinci insert ON CONFLICT yutulur.
    uniqueIndex("uniq_inbound_gmail_msg")
      .on(t.gmailMessageId)
      .where(sql`${t.direction} = 'in' AND ${t.gmailMessageId} IS NOT NULL`),
  ],
);

export const suppression = pgTable("suppression", {
  email: text("email").primaryKey(), // küçük-harf normalize
  reason: suppReasonEnum("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    payloadJson: jsonb("payload_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_events_type").on(t.type, t.createdAt)],
);

// ADR-0006 §2.5: Telegram dar-onay yüzeyinde tutulan kararsız aksiyonlar.
// id'nin ilk 8 char'ı callback_data prefix'i olarak kullanılır (~22 byte toplam,
// Telegram'ın 64 byte sınırına bol marj). 7 gün TTL; resolve atomic CAS.
export const pendingActions = pgTable(
  "pending_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: pendingActionKindEnum("kind").notNull(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    gmailDraftId: text("gmail_draft_id"),
    gmailThreadId: text("gmail_thread_id"),
    payload: jsonb("payload").notNull().default({}),
    status: pendingActionStatusEnum("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_pending_status_expires").on(t.status, t.expiresAt),
    index("idx_pending_lead").on(t.leadId),
  ],
);
