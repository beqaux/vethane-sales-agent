import type {
  Lead,
  SequenceState,
  Message,
  InboundMessage,
  DraftRequest,
  Candidate,
} from "./types";
import type {
  Classification,
  LeadDurum,
  Segment,
  SuppReason,
  Tier,
  EmailConfidence,
} from "./enums";

// --- Dış servis portları (Adapter pattern, IMPL §2.1) ---

export interface EmailProvider {
  createDraft(
    threadId: string | null,
    to: string,
    subject: string,
    body: string,
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
  ): Promise<{ cls: Classification; confidence: number; segmentGuess?: Segment }>;
}

export interface NotifyPort {
  notify(text: string): Promise<void>;
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
}

export interface SequenceRepo {
  get(leadId: string): Promise<SequenceState | null>;
  save(state: SequenceState): Promise<void>;
  create(leadId: string): Promise<SequenceState>;
}

export interface MessageRepo {
  add(msg: Omit<Message, "id" | "createdAt">): Promise<Message>;
  existsInbound(gmailMessageId: string): Promise<boolean>;
}

export interface SuppressionRepo {
  has(email: string): Promise<boolean>;
  add(email: string, reason: SuppReason): Promise<void>;
}

export interface EventRepo {
  log(type: string, leadId: string | null, payload?: unknown): Promise<void>;
}
