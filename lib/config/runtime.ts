import { z } from "zod";
import type { ActionType, Tier } from "../domain/enums";

// Çalışma-anı tunable config.
export const RUNTIME = {
  // Yalnız bu tier'lar outbound'a girer (CONTEXT: Tier1=250 premium ile başla).
  activeTiers: [1] as Tier[],
  seq: { maxSteps: 3, gapDays: 4 },
};

// Aksiyon bazlı otomasyon modu (SPEC §3.3.2).
// Reply path'leri auto: fiyatsız demo-yönlendirme + opt-out + guardrail'ler aktif,
// hızlı yanıt premium lead deneyimini artırır. Cold/takip'ler hala manual —
// ilk temas tonunu kurucu görsün.
export const ACTION_MODES: Record<ActionType, "manual" | "auto"> = {
  // Solo + demo + cikis: auto (hız öncelikli, guardrail'ler aktif).
  solo_cold: "auto",
  solo_takip: "auto",
  solo_fiyat: "auto",
  demo_reply: "auto",
  cikis_reply: "auto",
  // Mid/Hospital reply: auto — fiyat guardrail aktif, demoya yönlendirme tek mesaj,
  // bildirim de gidiyor (kurucu Telegram'dan takip eder).
  mid_reply: "auto",
  hospital_reply: "auto",
  // Demo onayı SONRASI takip ("teşekkürler", "OK" gibi): bot karışmaz, kurucu görür.
  demo_followup: "manual",
  // Cold/takip premium hala manuel — ilk temas tonu kurucu kontrolünde.
  mid_cold: "manual",
  mid_takip: "manual",
  hospital_cold: "manual",
  hospital_takip: "manual",
};

// Marka / mesaj sabitleri.
export const BRAND = {
  senderName: process.env.SENDER_NAME ?? "Vethane",
  senderEmail: process.env.SENDER_EMAIL ?? "info@vethane.com",
  optOutText: "Bu e-postaları almak istemiyorsanız bu mesaja 'çık' yazarak yanıtlamanız yeterli.",
};

// Yükleme-anı doğrulama.
z.object({
  maxSteps: z.number().int().positive(),
  gapDays: z.number().int().positive(),
}).parse(RUNTIME.seq);
