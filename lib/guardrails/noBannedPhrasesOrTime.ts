import type { Guardrail } from "./types";

// Üçlü korumanın 3. katmanı (deterministik). Prompt-yasağı ispatlı sızıyor:
// prod'da "Handaki", "Tüm sistem — harika!", "kliniğinize tam uyumlu olup olmadığını"
// gibi yapay/gibberish ifadeler auto-sent cevaplara çıktı. Prompt soft kuralı tek
// başına yetmiyor → burada sızarsa gönderme; runGuardrails reddi notify.failure ile
// Telegram'a düşer (kurucu görür).
const BANNED_PHRASES: RegExp[] = [
  /t[üu]m sistem\s*[—–-]?\s*harika/i, // em-dash / en-dash / hyphen / boşluk varyasyonları
  /\bhandaki\b/i, // gibberish
  /bize uygun saatleri yazabilir misiniz/i, // yapay
  /sistemde neler olabilece[ğg]ini/i,
  /klini[ğg]inize tam uyumlu olup olmad[ıi][ğg][ıi]n[ıi]/i,
];

// Demo/mid/hospital cevapları SADECE müsaitlik SORAR; asla belirli saat ÖNERMEZ.
// (AI uydurdu: "alternatif olarak Çarşamba 10:00 veya Cuma 14:00".) Bu ask-only
// aksiyonlarda gövdede somut saat (HH:MM / "saat 15") yasak.
// NOT (red-team): demo_reply HARİÇ — demo_reply müşterinin önerdiği saati teyiden
// EKO edebilir (ADR-0006 §2.4); orada HH:MM yasaklamak meşru teyitleri bloklar.
const ASK_ONLY_ACTIONS = new Set(["mid_reply", "hospital_reply"]);
const SPECIFIC_TIME: RegExp[] = [
  /\b\d{1,2}[:.]\d{2}\b/, // "15:30", "10.00"
  /\bsaat\s*\d{1,2}\b/i, // "saat 15"
];

export const noBannedPhrasesOrTime: Guardrail = (d) => {
  const text = `${d.subject}\n${d.body}`;
  for (const re of BANNED_PHRASES) {
    if (re.test(text)) {
      return { ok: false, reason: `yasak/yapay ifade tespit edildi (${re.source})` };
    }
  }
  if (ASK_ONLY_ACTIONS.has(d.action)) {
    for (const re of SPECIFIC_TIME) {
      if (re.test(text)) {
        return {
          ok: false,
          reason: `ask-only cevapta uydurma saat önerisi tespit edildi (${re.source})`,
        };
      }
    }
  }
  return { ok: true };
};
