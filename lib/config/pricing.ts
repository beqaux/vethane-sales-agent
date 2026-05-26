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

// --- Mid bandı (3-5 vet) — Referans tablosu ---
// PRICING.md §2 v3.2 ile aynı. AI bu sayıları KULLANMAZ (guardrail mid/hospital fiyat yasağı aktif);
// kurucu referansı + ileride otomatize edilirse teklif görüşmesi için.
export const MID_PRICES = {
  taban: 3200,
  doktorPerVet: 220,
  muhasebe: 3300,
  ik: 2800,
  analitik: 2000,
  kafe: 900,
} as const;

// --- Hospital bandı (6+ vet) — Referans tablosu ---
export const HOSPITAL_PRICES = {
  taban: 5400,
  doktorPerVet: 195,
  muhasebe: 7000,
  ik: 5800,
  analitik: 4100,
  kafe: 1400,
} as const;

export type PricingModule = "muhasebe" | "ik" | "analitik" | "kafe";

interface PriceTable {
  taban: number;
  doktorPerVet: number;
  muhasebe: number;
  ik: number;
  analitik: number;
  kafe: number;
}

function calcPrice(
  table: PriceTable,
  opts: { modules: PricingModule[]; vetCount: number },
): SoloPriceResult {
  const taban = table.taban;
  const doktor = table.doktorPerVet * Math.max(0, opts.vetCount);
  const moduleSum = opts.modules.reduce((s, m) => s + table[m], 0);
  const discount = expansionDiscount(opts.modules.length);
  const modulesDiscounted = Math.round(moduleSum * (1 - discount));
  return {
    total: taban + doktor + modulesDiscounted,
    taban,
    doktor,
    moduleSum,
    discount,
    modulesDiscounted,
  };
}

export function getMidPrice(opts: { modules: PricingModule[]; vetCount: number }): SoloPriceResult {
  return calcPrice(MID_PRICES, opts);
}

export function getHospitalPrice(opts: {
  modules: PricingModule[];
  vetCount: number;
}): SoloPriceResult {
  return calcPrice(HOSPITAL_PRICES, opts);
}

const PriceTableSchema = z.object({
  taban: z.number().positive(),
  doktorPerVet: z.number().positive(),
  muhasebe: z.number().positive(),
  ik: z.number().positive(),
  analitik: z.number().positive(),
  kafe: z.number().positive(),
});
PriceTableSchema.parse(MID_PRICES);
PriceTableSchema.parse(HOSPITAL_PRICES);
