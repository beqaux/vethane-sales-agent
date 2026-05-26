import type {
  Segment,
  KurumTur,
  LeadDurum,
  SeqStatus,
  Classification,
  MsgDir,
  MsgStatus,
  SuppReason,
  EmailConfidence,
  Tier,
  ActionType,
} from "./enums";

// --- Çekirdek varlıklar (SPEC §5) ---

export interface Lead {
  id: string;
  kurumAdi: string;
  sehir: string | null;
  tur: KurumTur | null;
  vetSayisi: number | null;
  segment: Segment;
  tier: Tier;
  email: string | null;
  emailConfidence: EmailConfidence | null;
  website: string | null;
  placeId: string | null;
  phone: string | null;
  instagram: string | null;
  kararVerici: string | null;
  kaynak: string | null;
  durum: LeadDurum;
  gmailThreadId: string | null;
  alternateEmails: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface SequenceState {
  leadId: string;
  currentStep: number;
  nextActionAt: Date | null;
  lastSentAt: Date | null;
  status: SeqStatus;
}

export interface Message {
  id: string;
  leadId: string;
  direction: MsgDir;
  gmailMessageId: string | null;
  subject: string | null;
  body: string | null;
  classification: Classification | null;
  status: MsgStatus | null;
  createdAt: Date;
}

export interface SuppressionEntry {
  email: string;
  reason: SuppReason;
  createdAt: Date;
}

// --- AI / playbook ---

export interface Knowledge {
  positioning: string;
  faq: string;
  objections: string;
}

/** Playbook'un (Strategy) ürettiği outbound taslak planı. */
export interface DraftSpec {
  action: ActionType;
  segment: Segment;
  isCold: boolean;
  goal: string; // AI'a hedef
  guidance: string; // playbook scripti/talimatı (prompt'a enjekte)
  includePrice?: boolean; // yalnız solo
  priceText?: string; // config'ten render (solo)
  trialUrl?: string;
}

/** Inbound cevaba playbook'un ürettiği yanıt planı. */
export interface ReplyPlan {
  action: ActionType;
  goal: string;
  guidance: string;
  sendDraft: boolean; // yanıt taslağı üretilsin mi? (ilgisiz/oto_yanit → false)
  notify: boolean; // hot signal → Telegram?
  stopSequence: boolean;
  rescheduleDays?: number; // oto_yanit (OOO) → sekansı ertele
  suppress: boolean;
  newDurum?: LeadDurum;
  includePrice?: boolean;
  priceText?: string;
  trialUrl?: string;
}

/** AI taslak üretimine giden normalize istek. */
export interface DraftRequest {
  segment: Segment;
  isReply: boolean;
  isCold: boolean;
  goal: string;
  guidance: string;
  lead: Lead;
  knowledge: Knowledge;
  priceText?: string;
  trialUrl?: string;
  threadContext?: string;
}

export interface InboundMessage {
  gmailMessageId: string;
  threadId: string;
  fromEmail: string;
  subject: string;
  body: string; // düz metin
  receivedAt: Date;
}

// --- Guardrail ---

export interface GuardCtx {
  lead: Lead;
  suppressed: boolean;
}

export type GuardResult = { ok: true } | { ok: false; reason: string };

/** Guardrail'lerin değerlendirdiği giden taslak. */
export interface OutboundDraft {
  subject: string;
  body: string;
  segment: Segment;
  isCold: boolean;
  action: ActionType;
  toEmail: string;
}

// --- Lead sourcing/enrichment ---

export interface Candidate {
  kurumAdi: string;
  sehir: string | null;
  tur: KurumTur | null;
  website: string | null;
  phone: string | null;
  placeId: string | null;
  kaynak: string;
}
