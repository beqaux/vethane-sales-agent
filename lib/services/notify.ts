import type { NotifyPort, ButtonRow, NotifyMessage } from "../domain/ports";
import type { Lead, InboundMessage } from "../domain/types";
import type { ActionType } from "../domain/enums";
import type { ClassificationResult } from "../domain/schemas";
import { gmailThreadUrl } from "../util/demo-template";

export interface NotifyEnrichment {
  cls?: ClassificationResult;
  premiumMatch?: boolean;
}

export interface FailureNotifyOpts {
  kind: "guardrail" | "error";
  lead?: Lead | null;
  action?: ActionType;
  reason: string;
  /** Mevcut Gmail thread URL'i — yoksa lead.gmailThreadId'den türetilir. */
  threadLink?: string;
}

export interface DemoTimeApprovalOpts {
  lead: Lead;
  fromEmail: string;
  rawTime: string;
  previewBody: string;
  threadId: string | null;
  tokenPrefix: string;
}

export interface ColdDraftApprovalOpts {
  lead: Lead;
  threadId: string | null;
  subject: string;
  body: string;
  currentStep: number;
  tokenPrefix: string;
}

export interface UncertainReplyApprovalOpts {
  lead: Lead;
  cls: ClassificationResult;
  msgBody: string;
  draftBody: string;
  threadId: string | null;
  tokenPrefix: string;
}

export interface NotifyService {
  hot(label: string, lead: Lead, msg: InboundMessage, enrich?: NotifyEnrichment): Promise<void>;
  /**
   * Guardrail block veya inbound/outbound error — kurucu Telegram'da görür.
   * ADR-0006 §2.3: yeni bildirim kanalı, sessiz hata yok.
   */
  failure(opts: FailureNotifyOpts): Promise<void>;
  /** ADR-0006 §2.1 akış #3 — demo saat onayı (2 buton). */
  demoTimeApproval(opts: DemoTimeApprovalOpts): Promise<NotifyMessage | null>;
  /** ADR-0006 §2.1 akış #1 — cold premium taslak onayı (3 buton). */
  coldDraftApproval(opts: ColdDraftApprovalOpts): Promise<NotifyMessage | null>;
  /** ADR-0006 §2.1 akış #5 — belirsiz cevap taslağı onayı (3 buton). */
  uncertainReplyApproval(opts: UncertainReplyApprovalOpts): Promise<NotifyMessage | null>;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function clinikLabel(lead: Lead): string {
  return `${lead.kurumAdi}${lead.sehir ? " · " + lead.sehir : ""}`;
}

export function formatDemoTimeApproval(opts: {
  lead: Lead;
  fromEmail: string;
  rawTime: string;
  previewBody: string;
}): string {
  return [
    "📅 Demo saati önerdi",
    `Klinik: ${clinikLabel(opts.lead)}`,
    `Müşteri: ${opts.fromEmail}`,
    "",
    `Müşteri öneri: "${opts.rawTime}"`,
    "",
    "Bot şu cevabı atacak:",
    `"${opts.previewBody}"`,
  ].join("\n");
}

export function formatColdDraftApproval(opts: {
  lead: Lead;
  subject: string;
  body: string;
  currentStep: number;
}): string {
  return [
    "🆕 Premium cold taslak hazır",
    `Klinik: ${clinikLabel(opts.lead)} · Tier ${opts.lead.tier} · ${opts.lead.segment}`,
    `Adım: ${opts.currentStep}/3`,
    "",
    `Konu: ${opts.subject}`,
    "",
    truncate(opts.body, 3500),
  ].join("\n");
}

export function formatUncertainReplyApproval(opts: {
  lead: Lead;
  cls: ClassificationResult;
  msgBody: string;
  draftBody: string;
}): string {
  return [
    "❓ Belirsiz cevap (AI tahmini taslak)",
    `Klinik: ${clinikLabel(opts.lead)}`,
    `AI: cls=${opts.cls.cls}, confidence=${opts.cls.confidence.toFixed(2)}`,
    "",
    "Müşteri mesajı:",
    truncate(opts.msgBody, 400),
    "",
    "AI'nın taslağı:",
    truncate(opts.draftBody, 3500),
  ].join("\n");
}

function format(label: string, lead: Lead, msg: InboundMessage, e?: NotifyEnrichment): string {
  const link = lead.gmailThreadId ? gmailThreadUrl(lead.gmailThreadId) : "(thread linki yok)";
  const lines = [
    label,
    `Gönderen: ${msg.fromEmail}`,
    `Klinik: ${lead.kurumAdi}${lead.sehir ? ` (${lead.sehir})` : ""}`,
    `Segment: ${lead.segment} · Tier ${lead.tier}`,
  ];
  if (e?.cls) {
    lines.push(
      `AI: cls=${e.cls.cls}, confidence=${e.cls.confidence.toFixed(2)}` +
        (e.cls.segmentGuess ? `, segmentGuess=${e.cls.segmentGuess}` : ""),
    );
  }
  if (e?.premiumMatch != null) {
    lines.push(`Premium sinyal: ${e.premiumMatch ? "VAR" : "yok"}`);
  }
  lines.push(`Konu: ${msg.subject}`);
  lines.push(`Mesaj: ${truncate(msg.body.trim(), 280)}`);
  lines.push(`Gmail: ${link}`);
  return lines.join("\n");
}

export function formatFailure(opts: FailureNotifyOpts): string {
  const prefix = opts.kind === "guardrail" ? "🚫 Block" : "⚠️ Error";
  const lines: string[] = [prefix];
  if (opts.lead) {
    lines.push(
      `Klinik: ${opts.lead.kurumAdi}${opts.lead.sehir ? " · " + opts.lead.sehir : ""}`,
    );
  }
  if (opts.action) {
    lines.push(`Action: ${opts.action}`);
  }
  lines.push(`Sebep: ${truncate(opts.reason, 400)}`);
  return lines.join("\n");
}

export function createNotifyService(port: NotifyPort): NotifyService {
  return {
    async hot(label, lead, msg, enrich) {
      try {
        await port.notify(format(label, lead, msg, enrich));
      } catch {
        /* bildirim best-effort */
      }
    },
    async failure(opts) {
      const link = opts.threadLink ?? gmailThreadUrl(opts.lead?.gmailThreadId);
      const buttons: ButtonRow[] | undefined = link
        ? [[{ text: "✏️ Gmail", url: link }]]
        : undefined;
      try {
        await port.notify(formatFailure(opts), buttons ? { buttons } : undefined);
      } catch {
        /* bildirim best-effort */
      }
    },
    async demoTimeApproval(opts) {
      const text = formatDemoTimeApproval({
        lead: opts.lead,
        fromEmail: opts.fromEmail,
        rawTime: opts.rawTime,
        previewBody: opts.previewBody,
      });
      const link = gmailThreadUrl(opts.threadId);
      const buttons: ButtonRow[] = [
        [{ text: "✅ Onayla", callback_data: `act:${opts.tokenPrefix}:confirm` }],
      ];
      if (link) buttons[0].push({ text: "✏️ Gmail", url: link });
      try {
        return await port.notify(text, { buttons });
      } catch {
        return null;
      }
    },
    async coldDraftApproval(opts) {
      const text = formatColdDraftApproval({
        lead: opts.lead,
        subject: opts.subject,
        body: opts.body,
        currentStep: opts.currentStep,
      });
      const link = gmailThreadUrl(opts.threadId);
      const row: ButtonRow = [
        { text: "✅ Gönder", callback_data: `act:${opts.tokenPrefix}:send` },
        { text: "❌ İptal", callback_data: `act:${opts.tokenPrefix}:cancel` },
      ];
      if (link) row.push({ text: "✏️ Gmail", url: link });
      try {
        return await port.notify(text, { buttons: [row] });
      } catch {
        return null;
      }
    },
    async uncertainReplyApproval(opts) {
      const text = formatUncertainReplyApproval({
        lead: opts.lead,
        cls: opts.cls,
        msgBody: opts.msgBody,
        draftBody: opts.draftBody,
      });
      const link = gmailThreadUrl(opts.threadId);
      const row: ButtonRow = [
        { text: "✅ Gönder", callback_data: `act:${opts.tokenPrefix}:send` },
        { text: "❌ İptal", callback_data: `act:${opts.tokenPrefix}:cancel` },
      ];
      if (link) row.push({ text: "✏️ Gmail", url: link });
      try {
        return await port.notify(text, { buttons: [row] });
      } catch {
        return null;
      }
    },
  };
}
