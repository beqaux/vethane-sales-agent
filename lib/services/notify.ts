import type { NotifyPort, ButtonRow } from "../domain/ports";
import type { Lead, InboundMessage } from "../domain/types";
import type { ActionType } from "../domain/enums";
import type { ClassificationResult } from "../domain/schemas";

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

export interface NotifyService {
  hot(label: string, lead: Lead, msg: InboundMessage, enrich?: NotifyEnrichment): Promise<void>;
  /**
   * Guardrail block veya inbound/outbound error — kurucu Telegram'da görür.
   * ADR-0006 §2.3: yeni bildirim kanalı, sessiz hata yok.
   */
  failure(opts: FailureNotifyOpts): Promise<void>;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function gmailThreadUrl(threadId: string | null | undefined): string | null {
  if (!threadId) return null;
  return `https://mail.google.com/mail/u/0/#all/${threadId}`;
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
  };
}
