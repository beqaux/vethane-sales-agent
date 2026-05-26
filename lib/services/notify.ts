import type { NotifyPort } from "../domain/ports";
import type { Lead, InboundMessage } from "../domain/types";
import type { ClassificationResult } from "../domain/schemas";

export interface NotifyEnrichment {
  cls?: ClassificationResult;
  premiumMatch?: boolean;
}

export interface NotifyService {
  hot(label: string, lead: Lead, msg: InboundMessage, enrich?: NotifyEnrichment): Promise<void>;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function format(label: string, lead: Lead, msg: InboundMessage, e?: NotifyEnrichment): string {
  const link = lead.gmailThreadId
    ? `https://mail.google.com/mail/u/0/#all/${lead.gmailThreadId}`
    : "(thread linki yok)";
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

export function createNotifyService(port: NotifyPort): NotifyService {
  return {
    async hot(label, lead, msg, enrich) {
      try {
        await port.notify(format(label, lead, msg, enrich));
      } catch {
        /* bildirim best-effort */
      }
    },
  };
}
