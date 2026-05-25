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

function stripHtml(s: string): string {
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
