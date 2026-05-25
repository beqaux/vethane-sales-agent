import type { NotifyPort } from "../domain/ports";
import type { Lead, InboundMessage } from "../domain/types";

export interface NotifyService {
  hot(label: string, lead: Lead, msg: InboundMessage): Promise<void>;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function format(label: string, lead: Lead, msg: InboundMessage): string {
  const link = lead.gmailThreadId
    ? `https://mail.google.com/mail/u/0/#all/${lead.gmailThreadId}`
    : "(thread linki yok)";
  return [
    label,
    `Klinik: ${lead.kurumAdi}${lead.sehir ? ` (${lead.sehir})` : ""}`,
    `Segment: ${lead.segment} · Tier ${lead.tier}`,
    `Mesaj: ${truncate(msg.body.trim(), 280)}`,
    `Gmail: ${link}`,
  ].join("\n");
}

export function createNotifyService(port: NotifyPort): NotifyService {
  return {
    async hot(label, lead, msg) {
      try {
        await port.notify(format(label, lead, msg));
      } catch {
        /* bildirim best-effort — akışı durdurmasın */
      }
    },
  };
}
