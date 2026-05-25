import { playbookFor } from "../playbooks";
import { getKnowledge } from "../ai/knowledge";
import { runGuardrails } from "../guardrails";
import { advance } from "./sequence";
import { WARMUP } from "../config/warmup";
import { RUNTIME, ACTION_MODES, BRAND } from "../config/runtime";
import type {
  LeadRepo,
  SequenceRepo,
  SuppressionRepo,
  MessageRepo,
  EventRepo,
  EmailProvider,
  AiPort,
} from "../domain/ports";
import type { DraftRequest, OutboundDraft } from "../domain/types";

export interface OutboundDeps {
  leads: LeadRepo;
  seq: SequenceRepo;
  supp: SuppressionRepo;
  msgs: MessageRepo;
  events: EventRepo;
  mail: EmailProvider;
  ai: AiPort;
}

export interface OutboundResult {
  processed: number;
  sent: number;
  blocked: number;
}

export function createOutboundService(deps: OutboundDeps) {
  return {
    async processDue(now: Date = new Date()): Promise<OutboundResult> {
      const cap = WARMUP.startCap;
      const due = await deps.leads.dueForSend(now, RUNTIME.activeTiers, cap);
      let sent = 0;
      let blocked = 0;

      for (const lead of due) {
        if (!lead.email) continue;

        const spec = playbookFor(lead.segment).buildOutbound(lead, lead.seq.currentStep);
        const req: DraftRequest = {
          segment: spec.segment,
          isReply: false,
          isCold: spec.isCold,
          goal: spec.goal,
          guidance: spec.guidance,
          lead,
          knowledge: getKnowledge(),
          priceText: spec.priceText,
          trialUrl: spec.trialUrl,
        };

        const generated = await deps.ai.writeDraft(req);
        // Opt-out'u DETERMİNİSTİK ekle (AI'a güvenme) — cold ise.
        const body = spec.isCold ? `${generated.body}\n\n${BRAND.optOutText}` : generated.body;
        const draft: OutboundDraft = {
          subject: generated.subject,
          body,
          segment: spec.segment,
          isCold: spec.isCold,
          action: spec.action,
          toEmail: lead.email,
        };

        const suppressed = await deps.supp.has(lead.email);
        const g = runGuardrails(draft, { lead, suppressed });
        if (!g.ok) {
          await deps.events.log("guardrail_block", lead.id, { reason: g.reason, action: spec.action });
          blocked++;
          continue;
        }

        const auto = ACTION_MODES[spec.action] === "auto";
        const created = await deps.mail.createDraft(
          lead.gmailThreadId,
          lead.email,
          draft.subject,
          draft.body,
        );
        if (created.threadId && !lead.gmailThreadId) {
          await deps.leads.setThread(lead.id, created.threadId);
        }
        const labelThread = lead.gmailThreadId ?? created.threadId;
        if (labelThread) {
          try {
            await deps.mail.addLabel(labelThread, "vethane/sekansta");
          } catch {
            /* etiket opsiyonel */
          }
        }
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
        await deps.seq.save(advance(lead.seq, now, RUNTIME.seq));
        if (lead.durum === "yeni") await deps.leads.updateDurum(lead.id, "sekansta");
        await deps.events.log("outbound_draft", lead.id, {
          action: spec.action,
          step: lead.seq.currentStep,
          auto,
        });
        sent++;
      }

      return { processed: due.length, sent, blocked };
    },
  };
}
