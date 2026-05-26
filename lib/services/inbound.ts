import { playbookFor, detectPremiumSignal } from "../playbooks";
import { getKnowledge } from "../ai/knowledge";
import { runGuardrails } from "../guardrails";
import { onReply, onOptout, reschedule } from "./sequence";
import { ACTION_MODES } from "../config/runtime";
import { emailDomain, isFreeMailDomain } from "../util/email-parse";
import { deriveSegment, deriveTier } from "../util/segment";
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
import type { InboundMessage, DraftRequest, OutboundDraft } from "../domain/types";
import type { Segment, Classification } from "../domain/enums";

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
}): string {
  const prefix = opts.isNewLead ? "🆕 Web inbound · " : "";
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

    await deps.msgs.add({
      leadId: lead.id,
      direction: "in",
      gmailMessageId: msg.gmailMessageId,
      subject: msg.subject,
      body: msg.body,
      classification: cls.cls,
      status: null,
    });

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

    // Bildirim: yeni lead VE/VEYA plan.notify durumunda — tek bildirim, birleşik label.
    if (isNewLead || plan.notify) {
      const premiumMatch = segment === "unknown" ? detectPremiumSignal({ lead, msg, cls }) : false;
      const label = notifyLabel({ isNewLead, cls: cls.cls, segment, premiumMatch });
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
        }
      }
      return { processed };
    },
  };
}
