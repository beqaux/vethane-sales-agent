import type {
  Lead,
  SequenceState,
  Message,
  InboundMessage,
  DraftRequest,
  Candidate,
  PendingAction,
} from "./types";
import type {
  Classification,
  LeadDurum,
  Segment,
  SuppReason,
  Tier,
  EmailConfidence,
  PendingActionStatus,
} from "./enums";

// --- Dış servis portları (Adapter pattern, IMPL §2.1) ---

export interface EmailProvider {
  createDraft(
    threadId: string | null,
    to: string,
    subject: string,
    body: string,
    inReplyTo?: string | null,
  ): Promise<{ id: string; threadId: string | null }>;
  send(draftId: string): Promise<string>; // messageId
  listRecentInbound(maxResults?: number): Promise<InboundMessage[]>;
  addLabel(threadId: string, label: string): Promise<void>;
  watch(): Promise<{ historyId: string; expiration: number }>;
}

export interface AiPort {
  writeDraft(req: DraftRequest): Promise<{ subject: string; body: string }>;
  classify(
    msg: InboundMessage,
  ): Promise<{
    cls: Classification;
    confidence: number;
    segmentGuess?: Segment;
    vetCountGuess?: number;
  }>;
}

// Telegram inline keyboard (ADR-0006 §2.6).
export type TelegramButton =
  | { text: string; callback_data: string }
  | { text: string; url: string };
export type ButtonRow = TelegramButton[];

export interface NotifyOptions {
  buttons?: ButtonRow[];
}

export interface NotifyMessage {
  messageId: number;
  chatId: string;
}

export interface NotifyPort {
  /**
   * Telegram'a mesaj atar; opsiyonel inline keyboard buton matrisi.
   * Dönüş: edit/cleanup için chatId+messageId.
   */
  notify(text: string, opts?: NotifyOptions): Promise<NotifyMessage>;
  /** Mevcut bir mesajı edit'ler (button kaldırmak veya status satırı eklemek için). */
  edit(
    chatId: string,
    messageId: number,
    text: string,
    opts?: NotifyOptions,
  ): Promise<void>;
  /** Telegram'a "ack" + opsiyonel toast/alert. */
  answerCallback(
    callbackQueryId: string,
    opts?: { text?: string; alert?: boolean },
  ): Promise<void>;
}

export interface PlacesPort {
  searchClinics(query: string, opts?: { city?: string }): Promise<Candidate[]>;
}

// --- Repository portları ---

export interface LeadRepo {
  dueForSend(
    now: Date,
    tiers: number[],
    limit: number,
  ): Promise<Array<Lead & { seq: SequenceState }>>;
  byId(id: string): Promise<Lead | null>;
  byEmail(email: string): Promise<Lead | null>;
  byThread(threadId: string): Promise<Lead | null>;
  upsertByEmail(lead: Partial<Lead> & { email: string }): Promise<Lead>;
  updateDurum(id: string, durum: LeadDurum): Promise<void>;
  setThread(id: string, threadId: string): Promise<void>;
  upsertCandidate(
    c: Candidate & { segment: Segment; tier: Tier; email?: string | null },
  ): Promise<Lead>;
  listByDurum(durum: LeadDurum, limit?: number): Promise<Lead[]>;
  setEmail(id: string, email: string, confidence: EmailConfidence): Promise<void>;
  byDomain(domain: string): Promise<Lead | null>;
  addAlternateEmail(id: string, email: string): Promise<void>;
  updateVetCount(id: string, vetSayisi: number, segment: Segment, tier: Tier): Promise<void>;
}

export interface SequenceRepo {
  get(leadId: string): Promise<SequenceState | null>;
  save(state: SequenceState): Promise<void>;
  create(leadId: string): Promise<SequenceState>;
}

export interface MessageRepo {
  /** ON CONFLICT DO NOTHING — duplicate dedup edilirse null döner. */
  add(msg: Omit<Message, "id" | "createdAt">): Promise<Message | null>;
  existsInbound(gmailMessageId: string): Promise<boolean>;
}

export interface SuppressionRepo {
  has(email: string): Promise<boolean>;
  add(email: string, reason: SuppReason): Promise<void>;
}

export interface EventRepo {
  log(type: string, leadId: string | null, payload?: unknown): Promise<void>;
}

// ADR-0006 §2.5 — Telegram pending action repo.
export interface PendingActionRepo {
  /**
   * Yeni pending aksiyon yaratır. `id` opsiyonel — caller önceden generate edebilir
   * (notify mesajı atılırken callback_data prefix'i bilinmek için).
   */
  create(
    input: Omit<PendingAction, "id" | "createdAt" | "resolvedAt" | "status"> & {
      id?: string;
      status?: PendingActionStatus;
    },
  ): Promise<PendingAction>;
  byId(id: string): Promise<PendingAction | null>;
  /** id::text LIKE prefix||'%' AND status='pending' LIMIT 1 — 8-char prefix kullanılır. */
  byPrefix(prefix: string): Promise<PendingAction | null>;
  /**
   * Atomic CAS: status='pending' iken hedef statüsüne geçer.
   * Concurrent çağrılarda yarış kazananı bir tanedir — diğerlerine `false` döner.
   */
  resolve(
    id: string,
    finalStatus: "resolved" | "cancelled" | "expired",
  ): Promise<boolean>;
  /** payload jsonb'sini patch'ler (mevcut anahtarlar üzerine yazılır, kalanlar korunur). */
  updatePayload(id: string, patch: Record<string, unknown>): Promise<void>;
  /** expires_at < now && status='pending' → 'expired'; sayı döner. */
  expireDue(now: Date): Promise<number>;
}
