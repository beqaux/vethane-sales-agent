import type { Guardrail } from "./types";

// mid/hospital taslağında para/fiyat ASLA geçmemeli (değer-satışı). Üçlü korumanın 2. katmanı.
const PRICE_PATTERNS: RegExp[] = [
  /₺/,
  /\b\d[\d.,]*\s*(?:tl|try|lira)\b/i, // "11.370 TL", "11370 lira"
  /\b(?:tl|try|lira)\s*\d/i, // "TL 11370"
];

export const noPriceForBigSegment: Guardrail = (d) => {
  if (d.segment !== "mid" && d.segment !== "hospital") return { ok: true };
  const text = `${d.subject}\n${d.body}`;
  for (const re of PRICE_PATTERNS) {
    if (re.test(text)) {
      return { ok: false, reason: `mid/hospital taslağında fiyat/para tespit edildi (${re.source})` };
    }
  }
  return { ok: true };
};
