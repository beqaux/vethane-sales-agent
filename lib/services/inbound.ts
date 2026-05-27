import { playbookFor, detectPremiumSignal } from "../playbooks";
import { getKnowledge } from "../ai/knowledge";
import { runGuardrails } from "../guardrails";
import { onReply, onOptout, reschedule } from "./sequence";
import { ACTION_MODES, BRAND } from "../config/runtime";
import { emailDomain, isFreeMailDomain } from "../util/email-parse";
import { deriveSegment, deriveTier } from "../util/segment";
import {
  extractFirstName,
  renderConfirmTemplate,
} from "../util/demo-template";
import type { NotifyEnrichment } from "./notify";
import type {
  LeadRepo,
  SequenceRepo,
  SuppressionRepo,
  MessageRepo,
  EventRepo,
  EmailProvider,
  AiPort,
} from "../domain/ports";
import type { NotifyService } from "./notify";
import type { PendingActionService } from "./pending-action";
import type { InboundMessage, DraftRequest, OutboundDraft } from "../domain/types";
import type { Segment, Classification, ActionType } from "../domain/enums";

const CONF_THRESHOLD = 0.5;

export interface InboundDeps {
  leads: LeadRepo;
  seq: SequenceRepo;
  supp: SuppressionRepo;
  msgs: MessageRepo;
  events: EventRepo;
  mail: EmailProvider;
  ai: AiPort;
  notify: NotifyService;
  pendingActions: PendingActionService;
}

function labelFor(cls: Classification): string {
  if (cls === "demo") return "vethane/demo-istedi";
  if (cls === "cikis") return "vethane/cikti";
  return "vethane/cevap-geldi";
}

/** Telegram bildirim başlığı — yeni lead, premium sinyal, segment'e göre tek etiket. */
function notifyLabel(opts: {
  isNewLead: boolean;
  cls: Classification;
  segment: Segment;
  premiumMatch: boolean;
  action?: ActionType;
}): string {
  const prefix = opts.isNewLead ? "🆕 Web inbound · " : "";
  // Demo sonrası takip mesajı (durum=demo_istedi) — kurucu için ayrı etiket.
  if (opts.action === "demo_followup") {
    return `${prefix}💬 Demo sonrası mesaj — kurucu takip etsin`;
  }
  if (opts.cls === "demo") return `${prefix}🔥 DEMO İSTEĞİ`;
  if (opts.segment === "mid" || opts.segment === "hospital") {
    return `${prefix}🔥 Premium yanıt (${opts.segment})`;
  }
  if (opts.segment === "unknown" && opts.premiumMatch) {
    return `${prefix}🔥 Premium sinyal (segment belirsiz)`;
  }
  if (opts.segment === "unknown" && opts.cls === "fiyat") {
    return `${prefix}💰 Fiyat sorusu — manuel kontrol`;
  }
  return `${prefix}📩 Inbound yanıt`;
}

export function createInboundService(deps: InboundDeps) {
  async function handleMessage(msg: InboundMessage): Promise<void> {
    if (await deps.msgs.existsInbound(msg.gmailMessageId)) return; // dedup

    const cls = await deps.ai.classify(msg);
    // ADR-0006 §2.4: substring guardrail — AI uydurma proposedTime drop.
    if (cls.proposedTime && !msg.body.includes(cls.proposedTime.raw)) {
      await deps.events.log("classify_propose_time_hallucination", null, {
        raw: cls.proposedTime.raw,
        cls: cls.cls,
      });
      cls.proposedTime = undefined;
    }
    let lead =
      (msg.threadId ? await deps.leads.byThread(msg.threadId) : null) ??
      (await deps.leads.byEmail(msg.fromEmail));

    let isNewLead = false;
    if (!lead) {
      const domain = emailDomain(msg.fromEmail);
      if (domain && !isFreeMailDomain(domain)) {
        const existing = await deps.leads.byDomain(domain);
        if (existing) {
          await deps.leads.addAlternateEmail(existing.id, msg.fromEmail);
          lead = {
            ...existing,
            alternateEmails: [...existing.alternateEmails, msg.fromEmail.toLowerCase()],
          };
          await deps.events.log("inbound_lead_merged", lead.id, {
            from: msg.fromEmail,
            matchedDomain: domain,
          });
        }
      }
      if (!lead) {
        lead = await deps.leads.upsertByEmail({
          email: msg.fromEmail,
          kurumAdi: `Web inbound — ${msg.fromEmail}`,
          segment: "unknown",
          durum: "yeni",
          kaynak: "inbound",
        });
        await deps.events.log("inbound_new_lead", lead.id, { from: msg.fromEmail, cls: cls.cls });
        isNewLead = true;
      }
    }

    const inserted = await deps.msgs.add({
      leadId: lead.id,
      direction: "in",
      gmailMessageId: msg.gmailMessageId,
      subject: msg.subject,
      body: msg.body,
      classification: cls.cls,
      status: null,
    });
    // null → partial unique index ON CONFLICT yuttu (Pub/Sub at-least-once duplicate).
    // İkinci flow buradan sonrasını çalıştırmamalı: bildirim/draft tek kez gitsin.
    if (!inserted) return;

    // Mesajda vet sayısı bildirildiyse lead'i güncelle ve segmenti yeniden hesapla.
    // Aksi takdirde ilk yaratıldığı segment'te (örn. solo) kilitli kalır.
    if (cls.vetCountGuess && cls.vetCountGuess !== lead.vetSayisi) {
      const newSegment = deriveSegment(cls.vetCountGuess, lead.tur);
      const newTier = deriveTier(newSegment, lead.tur);
      if (newSegment !== lead.segment || cls.vetCountGuess !== lead.vetSayisi) {
        await deps.leads.updateVetCount(lead.id, cls.vetCountGuess, newSegment, newTier);
        await deps.events.log("lead_segment_updated", lead.id, {
          from: lead.segment,
          to: newSegment,
          vetSayisi: cls.vetCountGuess,
        });
        lead = { ...lead, vetSayisi: cls.vetCountGuess, segment: newSegment, tier: newTier };
      }
    }

    const segment: Segment =
      lead.segment !== "unknown" ? lead.segment : (cls.segmentGuess ?? "unknown");
    const plan = playbookFor(segment).buildReply(lead, msg, cls);

    const labelThread = lead.gmailThreadId ?? msg.threadId;
    if (labelThread) {
      try {
        await deps.mail.addLabel(labelThread, labelFor(cls.cls));
      } catch {
        /* etiket opsiyonel */
      }
    }

    if (cls.confidence < CONF_THRESHOLD) {
      await deps.notify.hot("❓ Belirsiz cevap — elle bak", lead, msg, { cls });
    }

    if (plan.suppress) await deps.supp.add(lead.email ?? msg.fromEmail, "optout");

    const seq = await deps.seq.get(lead.id);
    if (seq) {
      if (plan.suppress) await deps.seq.save(onOptout(seq));
      else if (plan.stopSequence) await deps.seq.save(onReply(seq));
      else if (plan.rescheduleDays) await deps.seq.save(reschedule(seq, plan.rescheduleDays));
    }

    if (plan.newDurum) await deps.leads.updateDurum(lead.id, plan.newDurum);

    // ADR-0006 §2.1 akış #3 — demo_followup + literal proposedTime → pending_action + 2-buton.
    // demoTimeApproval atılırsa eski "💬 Demo sonrası mesaj" hot notify atlanır
    // (kurucu zaten buton mesajını alıyor — duplicate notify gerekmez).
    const isDemoTimePath =
      plan.action === "demo_followup" &&
      cls.proposedTime != null &&
      cls.proposedTime.raw.length > 0;
    let demoTimeHandled = false;
    if (isDemoTimePath && cls.proposedTime) {
      const { pending, tokenPrefix } = await deps.pendingActions.create({
        kind: "confirm_demo_time",
        leadId: lead.id,
        gmailThreadId: msg.threadId,
        payload: {
          proposedTimeRaw: cls.proposedTime.raw,
          fromEmail: msg.fromEmail,
          headerMessageId: msg.headerMessageId,
          subject: msg.subject,
        },
      });
      const ad = extractFirstName(lead, msg.fromEmail);
      const previewBody = renderConfirmTemplate(
        ad,
        cls.proposedTime.raw,
        BRAND.senderName,
      );
      const sent = await deps.notify.demoTimeApproval({
        lead,
        fromEmail: msg.fromEmail,
        rawTime: cls.proposedTime.raw,
        previewBody,
        threadId: msg.threadId,
        tokenPrefix,
      });
      if (sent) {
        // Telegram lokasyonu pending.payload'a yaz — T8 callback edit'te kullanır.
        await deps.pendingActions.updatePayload(pending.id, {
          telegram: { chatId: sent.chatId, messageId: sent.messageId },
        });
        await deps.events.log("demo_time_pending", lead.id, {
          pendingId: pending.id,
          raw: cls.proposedTime.raw,
        });
        demoTimeHandled = true;
      } else {
        // Notify atılamadı (Telegram down vs.) — pending'i cancel et,
        // fall-through eski hot notify'a düşer.
        await deps.pendingActions.resolve(pending.id, "cancelled");
      }
    }

    // Bildirim: yeni lead VE/VEYA plan.notify durumunda — tek bildirim, birleşik label.
    // demoTimeApproval atıldıysa eski hot notify atlanır (duplicate engeli).
    if (!demoTimeHandled && (isNewLead || plan.notify)) {
      const premiumMatch = segment === "unknown" ? detectPremiumSignal({ lead, msg, cls }) : false;
      const label = notifyLabel({
        isNewLead,
        cls: cls.cls,
        segment,
        premiumMatch,
        action: plan.action,
      });
      const enrich: NotifyEnrichment = {
        cls,
        premiumMatch: segment === "unknown" ? premiumMatch : undefined,
      };
      await deps.notify.hot(label, lead, msg, enrich);
    }

    if (plan.sendDraft) {
      const toEmail = lead.email ?? msg.fromEmail;
      const suppressed = await deps.supp.has(toEmail);
      const req: DraftRequest = {
        segment,
        isReply: true,
        isCold: false,
        goal: plan.goal,
        guidance: plan.guidance,
        lead,
        knowledge: getKnowledge(),
        priceText: plan.priceText,
        trialUrl: plan.trialUrl,
        threadContext: `${msg.subject}\n${msg.body}`.slice(0, 1200),
      };
      const gen = await deps.ai.writeDraft(req);
      const replySubject = /^re:\s/i.test(msg.subject)
        ? msg.subject
        : `Re: ${msg.subject}`;
      const draft: OutboundDraft = {
        subject: replySubject,
        body: gen.body,
        segment,
        isCold: false,
        action: plan.action,
        toEmail,
      };
      const g = runGuardrails(draft, { lead, suppressed });
      if (!g.ok) {
        await deps.events.log("guardrail_block", lead.id, { reason: g.reason, action: plan.action });
        // ADR-0006 §2.3: kurucu Telegram'da görsün — sessiz hata yok.
        await deps.notify.failure({
          kind: "guardrail",
          lead,
          action: plan.action,
          reason: g.reason,
        });
      } else {
        const replyThread = msg.threadId || lead.gmailThreadId;
        const created = await deps.mail.createDraft(
          replyThread,
          toEmail,
          draft.subject,
          draft.body,
          msg.headerMessageId,
        );
        if (created.threadId && created.threadId !== lead.gmailThreadId) {
          await deps.leads.setThread(lead.id, created.threadId);
        }
        const auto = ACTION_MODES[plan.action] === "auto" && cls.confidence >= CONF_THRESHOLD;
        if (auto) await deps.mail.send(created.id);
        await deps.msgs.add({
          leadId: lead.id,
          direction: "out",
          gmailMessageId: null,
          subject: draft.subject,
          body: draft.body,
          classification: null,
          status: auto ? "sent" : "draft",
        });
      }
    }

    await deps.events.log("inbound_handled", lead.id, { cls: cls.cls, segment, action: plan.action });
  }

  return {
    async handle(): Promise<{ processed: number }> {
      const messages = await deps.mail.listRecentInbound();
      let processed = 0;
      for (const msg of messages) {
        try {
          await handleMessage(msg);
          processed++;
        } catch (e) {
          const err = e as Error & { cause?: unknown };
          await deps.events.log("inbound_error", null, {
            from: msg.fromEmail,
            error: err.message ?? String(e),
            cause: err.cause ? String(err.cause).slice(0, 500) : undefined,
          });
          // ADR-0006 §2.3: sessiz hata yok — kurucu Telegram'da görür.
          await deps.notify.failure({
            kind: "error",
            reason: `inbound ${msg.fromEmail}: ${err.message ?? String(e)}`,
          });
        }
      }
      return { processed };
    },
  };
}
