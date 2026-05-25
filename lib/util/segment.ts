import type { Segment, KurumTur, Tier } from "../domain/enums";

/**
 * Segment türetme (SPEC §3.1.2).
 * Önce vet sayısı: >=6 hospital, 3-5 mid, 1-2 solo. Yoksa türden. İkisi de yoksa unknown.
 */
export function deriveSegment(
  vetSayisi: number | null | undefined,
  tur: KurumTur | null | undefined,
): Segment {
  if (vetSayisi != null && vetSayisi > 0) {
    if (vetSayisi >= 6) return "hospital";
    if (vetSayisi >= 3) return "mid";
    return "solo";
  }
  if (tur === "hastane") return "hospital";
  if (tur === "poliklinik") return "mid";
  if (tur === "muayenehane") return "solo";
  return "unknown";
}

/**
 * Outbound dalga önceliği (CONTEXT #1, kademeli hedefleme).
 * Tier 1 = premium kurumsal (poliklinik + hastane, ~250).
 * Tier 2 = 3 vet muayenehane (~770 bandı).
 * Tier 3 = solo muayenehane (1-2 vet) — cold'a alınmaz, self-servis.
 */
export function deriveTier(segment: Segment, tur: KurumTur | null | undefined): Tier {
  if (tur === "poliklinik" || tur === "hastane") return 1;
  if (tur === "muayenehane") return segment === "solo" ? 3 : 2;
  // Tür bilinmiyor → segmentten (kurumsal varsay).
  if (segment === "hospital" || segment === "mid") return 1;
  return 3;
}
