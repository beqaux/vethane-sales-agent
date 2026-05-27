// Gmail payload + e-posta çıkarma yardımcıları.

export function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

/** Metinden tekil, küçük harfli e-posta adresleri çıkarır. */
export function extractEmails(text: string): string[] {
  const re = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const found = text.match(re) ?? [];
  return [...new Set(found.map((e) => e.toLowerCase()))];
}

/** "Ad Soyad <a@b.com>" veya "a@b.com" → küçük harf e-posta. */
export function parseFromHeader(from: string): string | null {
  const m = from.match(/<([^>]+)>/);
  const email = (m ? m[1] : from).trim().toLowerCase();
  return /.+@.+\..+/.test(email) ? email : null;
}

type GmailPart = {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: GmailPart[] | null;
};

/** Gmail mesaj payload'undan düz metin çıkarır (text/plain öncelikli, yoksa html-stripped). */
export function extractPlainText(payload: GmailPart | null | undefined): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  for (const part of payload.parts ?? []) {
    const t = extractPlainText(part);
    if (t) return t;
  }
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return stripHtml(decodeBase64Url(payload.body.data));
  }
  return "";
}

// "27 May 2026 Çar, 01:54 tarihinde ... yazdı:", "On Mon, ... wrote:", Outlook "From: X" header bloğu.
const QUOTE_ATTRIBUTION = [
  /tarihinde\s+.*\s+yazd[ıi]\s*:?\s*$/i, // TR Gmail
  /^\s*on\s.+\swrote\s*:?\s*$/i, // EN Gmail
  /^\s*-{2,}\s*original message\s*-{2,}\s*$/i, // Outlook eski
  /^\s*from:\s+.+/i, // Outlook header bloğu başı
  /^\s*\d{1,2}[./-]\d{1,2}[./-]\d{2,4}.+?yazd[ıi]\s*:?\s*$/i, // alternatif TR format
];

/**
 * Gmail / Outlook tarzı alıntılanmış cevap metnini siler.
 * "3 veteriner var\n\nVethane <info@vethane.com>, 27 May 2026 ... şunu yazdı:\n> Merhaba..."
 * → "3 veteriner var"
 *
 * AI sınıflayıcı/üretici quoted geçmişi GÖRMEZ → yalnız kullanıcının asıl yanıtına bakar.
 */
export function stripQuotedReply(body: string): string {
  if (!body) return body;
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (line.trimStart().startsWith(">")) break;
    if (QUOTE_ATTRIBUTION.some((re) => re.test(line))) break;
    out.push(line);
  }
  return out.join("\n").replace(/\s+$/g, "").trim();
}

function stripHtml(s: string): string {
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "hotmail.com", "hotmail.com.tr", "outlook.com", "outlook.com.tr",
  "live.com", "windowslive.com", "msn.com",
  "yahoo.com", "yahoo.com.tr", "ymail.com",
  "icloud.com", "me.com", "mac.com",
  "mynet.com", "mynet.com.tr",
  "aol.com",
  "protonmail.com", "proton.me",
]);

export function emailDomain(email: string): string | null {
  const idx = email.indexOf("@");
  if (idx < 0) return null;
  return email.slice(idx + 1).toLowerCase();
}

export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL_DOMAINS.has(domain.toLowerCase());
}
