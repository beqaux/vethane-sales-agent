import type { Segment, KurumTur, Tier } from "../domain/enums";

/**
 * Segment türetme (SPEC §3.1.2 — 2026-05-26 tür-öncelikli güncelleme).
 * Tür ünvanı varsa her zaman önce o; vet sayısı sadece tür içinde refine eder.
 */
export function deriveSegment(
  vetSayisi: number | null | undefined,
  tur: KurumTur | null | undefined,
): Segment {
  if (tur === "hastane") return "hospital";
  if (tur === "poliklinik") {
    return vetSayisi != null && vetSayisi >= 6 ? "hospital" : "mid";
  }
  if (tur === "muayenehane") {
    if (vetSayisi == null) return "solo";
    return vetSayisi >= 3 ? "mid" : "solo";
  }
  if (vetSayisi != null && vetSayisi > 0) {
    if (vetSayisi >= 6) return "hospital";
    if (vetSayisi >= 3) return "mid";
    return "solo";
  }
  return "unknown";
}

export function deriveTier(segment: Segment, tur: KurumTur | null | undefined): Tier {
  if (tur === "poliklinik" || tur === "hastane") return 1;
  if (tur === "muayenehane") return segment === "solo" ? 3 : 2;
  if (segment === "hospital" || segment === "mid") return 1;
  return 3;
}
