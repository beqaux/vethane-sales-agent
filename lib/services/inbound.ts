import { playbookFor } from "../playbooks";
import { getKnowledge } from "../ai/knowledge";
import { runGuardrails } from "../guardrails";
import { onReply, onOptout, reschedule } from "./sequence";
import { ACTION_MODES } from "../config/runtime";
import { emailDomain, isFreeMailDomain } from "../util/email-parse";
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

export function createInboundService(deps: InboundDeps) {
  async function handleMessage(msg: InboundMessage): Promise<void> {
    if (await deps.msgs.existsInbound(msg.gmailMessageId)) return; // dedup

    const cls = await deps.ai.classify(msg);
    let lead =
      (msg.threadId ? await deps.leads.byThread(msg.threadId) : null) ??
      (await deps.leads.byEmail(msg.fromEmail));

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
        await deps.notify.hot(`🆕 Web inbound — ${cls.cls}`, lead, msg);
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

    const segment: Segment =
      lead.segment !== "unknown" ? lead.segment : (cls.segmentGuess ?? "unknown");
    const plan = playbookFor(segment).buildReply(lead, msg, cls.cls);

    const labelThread = lead.gmailThreadId ?? msg.threadId;
    if (labelThread) {
      try {
        await deps.mail.addLabel(labelThread, labelFor(cls.cls));
      } catch {
        /* etiket opsiyonel */
      }
    }

    if (cls.confidence < CONF_THRESHOLD) {
      await deps.notify.hot("❓ Belirsiz cevap — elle bak", lead, msg);
    }

    if (plan.suppress) await deps.supp.add(lead.email ?? msg.fromEmail, "optout");

    const seq = await deps.seq.get(lead.id);
    if (seq) {
      if (plan.suppress) await deps.seq.save(onOptout(seq));
      else if (plan.stopSequence) await deps.seq.save(onReply(seq));
      else if (plan.rescheduleDays) await deps.seq.save(reschedule(seq, plan.rescheduleDays));
    }

    if (plan.newDurum) await deps.leads.updateDurum(lead.id, plan.newDurum);

    if (plan.notify) {
      const label = cls.cls === "demo" ? "🔥 DEMO İSTEĞİ" : "🔥 Premium/ilgili yanıt";
      await deps.notify.hot(label, lead, msg);
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
      const draft: OutboundDraft = {
        subject: gen.subject || `Re: ${msg.subject}`,
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
        const created = await deps.mail.createDraft(
          lead.gmailThreadId ?? msg.threadId,
          toEmail,
          draft.subject,
          draft.body,
        );
        if (created.threadId && !lead.gmailThreadId) {
          await deps.leads.setThread(lead.id, created.threadId);
        }
        const auto = ACTION_MODES[plan.action] === "auto";
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
