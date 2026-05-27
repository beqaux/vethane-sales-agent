import { leads, sequenceState, messages, pendingActions } from "./schema";
import type { Lead, SequenceState, Message, PendingAction } from "../domain/types";
import type { Tier, EmailConfidence } from "../domain/enums";

export function toLead(r: typeof leads.$inferSelect): Lead {
  return {
    id: r.id,
    kurumAdi: r.kurumAdi,
    sehir: r.sehir,
    tur: r.tur,
    vetSayisi: r.vetSayisi,
    segment: r.segment,
    tier: r.tier as Tier,
    email: r.email,
    emailConfidence: r.emailConfidence as EmailConfidence | null,
    website: r.website,
    placeId: r.placeId,
    phone: r.phone,
    instagram: r.instagram,
    kararVerici: r.kararVerici,
    kaynak: r.kaynak,
    durum: r.durum,
    gmailThreadId: r.gmailThreadId,
    alternateEmails: r.alternateEmails ?? [],
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function toSeq(r: typeof sequenceState.$inferSelect): SequenceState {
  return {
    leadId: r.leadId,
    currentStep: r.currentStep,
    nextActionAt: r.nextActionAt,
    lastSentAt: r.lastSentAt,
    status: r.status,
  };
}

export function toMessage(r: typeof messages.$inferSelect): Message {
  return {
    id: r.id,
    leadId: r.leadId,
    direction: r.direction,
    gmailMessageId: r.gmailMessageId,
    subject: r.subject,
    body: r.body,
    classification: r.classification,
    status: r.status,
    createdAt: r.createdAt,
  };
}

export function toPendingAction(r: typeof pendingActions.$inferSelect): PendingAction {
  return {
    id: r.id,
    kind: r.kind,
    leadId: r.leadId,
    gmailDraftId: r.gmailDraftId,
    gmailThreadId: r.gmailThreadId,
    payload: (r.payload as Record<string, unknown> | null) ?? {},
    status: r.status,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
  };
}
