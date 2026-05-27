import type { Lead } from "../domain/types";

/**
 * ADR-0006 §2.6: Telegram inline-button → Gmail thread linki.
 * Buton url'i ve failure notify "✏️ Gmail" pattern'inde reuse edilir.
 */
export function gmailThreadUrl(threadId: string | null | undefined): string | null {
  if (!threadId) return null;
  return `https://mail.google.com/mail/u/0/#all/${threadId}`;
}

/**
 * Confirmation maili için müşterinin adı.
 * Öncelik: lead.kararVerici → from local-part (örn. "ahmet.yilmaz@..." → "Ahmet")
 * → null (bu durumda "Merhaba," kullanılır).
 */
export function extractFirstName(lead: Lead, fromEmail?: string | null): string | null {
  if (lead.kararVerici) {
    const first = lead.kararVerici.trim().split(/\s+/)[0];
    if (first && first.length >= 2) return capitalize(first);
  }
  if (fromEmail) {
    const local = fromEmail.split("@")[0] ?? "";
    // "ahmet.yilmaz" → "ahmet", "info" / "noreply" gibi generic ise skip.
    const first = local.split(/[._-]/)[0] ?? "";
    if (first.length >= 2 && !isGenericLocal(first)) return capitalize(first);
  }
  return null;
}

const GENERIC_LOCALS = new Set([
  "info",
  "noreply",
  "no-reply",
  "contact",
  "support",
  "iletisim",
  "destek",
  "satis",
  "office",
  "admin",
  "hello",
  "merhaba",
  "klinik",
  "vet",
]);

function isGenericLocal(s: string): boolean {
  return GENERIC_LOCALS.has(s.toLowerCase());
}

function capitalize(s: string): string {
  if (!s) return s;
  // Turkish-aware basic capitalize.
  return s.charAt(0).toLocaleUpperCase("tr-TR") + s.slice(1).toLocaleLowerCase("tr-TR");
}

/**
 * ADR-0006 §2.4: Demo zaman onayı confirmation maili template.
 * Müşterinin LİTERAL ifadesini echo eder — parse YOK, ISO YOK, link YOK
 * ("Link 15 dk önce iletilir" sabit cümle, fresh link kurucu manuel atar).
 */
export function renderConfirmTemplate(
  ad: string | null,
  raw: string,
  senderName: string,
): string {
  const selam = ad ? `Merhaba ${ad},` : "Merhaba,";
  return `${selam}

"${raw}" bende de uygun.
Görüşme linkini toplantıdan ~15 dk önce ileteceğim.

İyi çalışmalar,
${senderName}`;
}
