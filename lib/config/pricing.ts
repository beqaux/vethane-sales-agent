import { z } from "zod";

// Solo fiyat tablosu — TEK GERÇEK KAYNAK (₺/ay, KDV hariç). AI sayı üretmez, buradan çeker.
// Kaynak: Vethane fiyat dokümanı v3.2 (solo bandı). Tunable.
export const SOLO_PRICES = {
  taban: 1950, // Danışma (zorunlu taban)
  doktorPerVet: 260, // kişi başı/ay (solo bandı)
  muhasebe: 1950,
  ik: 1550,
  analitik: 1050,
  kafe: 650,
} as const;

export type SoloModule = "muhasebe" | "ik" | "analitik" | "kafe";

/** Çok-modül expansion indirimi (yalnız modüllere; taban + doktor hariç). */
export function expansionDiscount(moduleCount: number): number {
  if (moduleCount >= 4) return 0.15;
  if (moduleCount === 3) return 0.1;
  if (moduleCount === 2) return 0.05;
  return 0;
}

export interface SoloPriceResult {
  total: number;
  taban: number;
  doktor: number;
  moduleSum: number;
  discount: number;
  modulesDiscounted: number;
}

/** Solo segment fiyatı (deterministik). Örn. {modules:["muhasebe"], vetCount:1} → 4160. */
export function getSoloPrice(opts: { modules: SoloModule[]; vetCount: number }): SoloPriceResult {
  const taban = SOLO_PRICES.taban;
  const doktor = SOLO_PRICES.doktorPerVet * Math.max(0, opts.vetCount);
  const moduleSum = opts.modules.reduce((s, m) => s + SOLO_PRICES[m], 0);
  const discount = expansionDiscount(opts.modules.length);
  const modulesDiscounted = Math.round(moduleSum * (1 - discount));
  return { total: taban + doktor + modulesDiscounted, taban, doktor, moduleSum, discount, modulesDiscounted };
}

export function formatTRY(n: number): string {
  return `${n.toLocaleString("tr-TR")} ₺ + KDV`;
}

// Yükleme-anı doğrulama (geçersiz config build'i kırar).
z.object({
  taban: z.number().positive(),
  doktorPerVet: z.number().positive(),
  muhasebe: z.number().positive(),
  ik: z.number().positive(),
  analitik: z.number().positive(),
  kafe: z.number().positive(),
}).parse(SOLO_PRICES);
