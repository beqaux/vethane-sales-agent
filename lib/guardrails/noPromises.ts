import type { Guardrail } from "./types";

// İndirim / garanti / taahhüt gibi söz verme ifadeleri yasak (tüm segmentler).
const PROMISE_PATTERNS: RegExp[] = [
  /%\s*\d/, // "%10" indirim
  /\bindirim\b/i,
  /\bgaranti/i,
  /\btaahhüt\b/i,
];

export const noPromises: Guardrail = (d) => {
  const text = `${d.subject}\n${d.body}`;
  for (const re of PROMISE_PATTERNS) {
    if (re.test(text)) {
      return { ok: false, reason: `yasak söz/ifade tespit edildi (${re.source})` };
    }
  }
  return { ok: true };
};
