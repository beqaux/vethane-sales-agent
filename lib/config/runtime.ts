import { z } from "zod";
import type { ActionType, Tier } from "../domain/enums";

// Çalışma-anı tunable config.
export const RUNTIME = {
  // Yalnız bu tier'lar outbound'a girer (CONTEXT: Tier1=250 premium ile başla).
  activeTiers: [1] as Tier[],
  seq: { maxSteps: 3, gapDays: 4 },
};

// Aksiyon bazlı otomasyon modu — v1: hepsi 'manual' (Gmail taslağı, kurucu onaylar).
// Güven oluşunca düşük-riskli olanlar 'auto'ya alınır (SPEC §3.3.2).
export const ACTION_MODES: Record<ActionType, "manual" | "auto"> = {
  solo_cold: "manual",
  solo_takip: "manual",
  solo_fiyat: "manual",
  mid_cold: "manual",
  mid_takip: "manual",
  mid_reply: "manual",
  hospital_cold: "manual",
  hospital_takip: "manual",
  hospital_reply: "manual",
  demo_reply: "manual",
  cikis_reply: "manual",
};

// Marka / mesaj sabitleri.
export const BRAND = {
  senderName: process.env.SENDER_NAME ?? "Vethane",
  senderEmail: process.env.SENDER_EMAIL ?? "info@vethane.com",
  trialUrl: "https://vethane.com/deneme",
  optOutText: "Bu e-postaları almak istemiyorsanız bu mesaja 'çık' yazarak yanıtlamanız yeterli.",
};

// Yükleme-anı doğrulama.
z.object({
  maxSteps: z.number().int().positive(),
  gapDays: z.number().int().positive(),
}).parse(RUNTIME.seq);
