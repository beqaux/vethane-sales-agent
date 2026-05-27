// Domain enum'ları — saf (zod/DB bağımlılığı yok). Const dizi + literal union.

export const SEGMENTS = ["solo", "mid", "hospital", "unknown"] as const;
export type Segment = (typeof SEGMENTS)[number];

export const KURUM_TURLERI = ["muayenehane", "poliklinik", "hastane"] as const;
export type KurumTur = (typeof KURUM_TURLERI)[number];

export const LEAD_DURUMLARI = [
  "aday",
  "yeni",
  "sekansta",
  "cevap_geldi",
  "demo_istedi",
  "kazanildi",
  "kaybedildi",
  "cikti",
] as const;
export type LeadDurum = (typeof LEAD_DURUMLARI)[number];

export const SEQ_STATUSES = [
  "active",
  "paused",
  "stopped_replied",
  "stopped_optout",
  "completed",
] as const;
export type SeqStatus = (typeof SEQ_STATUSES)[number];

export const CLASSIFICATIONS = [
  "fiyat",
  "demo",
  "ilgili",
  "ilgisiz",
  "oto_yanit",
  "cikis",
  "satis_spami",
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const MSG_DIRECTIONS = ["out", "in"] as const;
export type MsgDir = (typeof MSG_DIRECTIONS)[number];

export const MSG_STATUSES = ["draft", "approved", "sent", "rejected"] as const;
export type MsgStatus = (typeof MSG_STATUSES)[number];

export const SUPP_REASONS = ["optout", "bounce", "manual"] as const;
export type SuppReason = (typeof SUPP_REASONS)[number];

export const EMAIL_CONFIDENCE = ["high", "low"] as const;
export type EmailConfidence = (typeof EMAIL_CONFIDENCE)[number];

export type Tier = 1 | 2 | 3;

// Ajan aksiyon tipleri (action-modes ve guardrail için).
export const ACTION_TYPES = [
  "solo_cold",
  "solo_takip",
  "solo_fiyat",
  "mid_cold",
  "mid_takip",
  "mid_reply",
  "hospital_cold",
  "hospital_takip",
  "hospital_reply",
  "demo_reply",
  "demo_followup",
  "cikis_reply",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];
