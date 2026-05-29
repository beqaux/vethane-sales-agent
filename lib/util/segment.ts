import type { Segment, KurumTur, Tier } from "../domain/enums";

/**
 * Vet sayısı → segment eşiği (kullanıcı kuralı): 1-2 solo, 3-4 mid, 5+ hospital.
 * Tek kaynak: hem tür-bağımsız fallback hem muayenehane bu eşiği kullanır.
 */
function segmentByVetCount(n: number): Segment {
  if (n >= 5) return "hospital";
  if (n >= 3) return "mid";
  return "solo";
}

/**
 * Segment türetme (SPEC §3.1.2 — tür-öncelikli; vet eşiği 1-2/3-4/5+).
 * Tür ünvanı varsa her zaman önce o; vet sayısı tür içinde refine eder.
 */
export function deriveSegment(
  vetSayisi: number | null | undefined,
  tur: KurumTur | null | undefined,
): Segment {
  if (tur === "hastane") return "hospital";
  if (tur === "poliklinik") {
    // Poliklinik tabanı en az mid (premium ünvan); 5+ vet → hospital.
    return vetSayisi != null && vetSayisi >= 5 ? "hospital" : "mid";
  }
  if (tur === "muayenehane") {
    if (vetSayisi == null) return "solo";
    return segmentByVetCount(vetSayisi);
  }
  if (vetSayisi != null && vetSayisi > 0) {
    return segmentByVetCount(vetSayisi);
  }
  return "unknown";
}

export function deriveTier(segment: Segment, tur: KurumTur | null | undefined): Tier {
  if (tur === "poliklinik" || tur === "hastane") return 1;
  if (tur === "muayenehane") return segment === "solo" ? 3 : 2;
  if (segment === "hospital" || segment === "mid") return 1;
  return 3;
}
