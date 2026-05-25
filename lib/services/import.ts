import { deriveSegment, deriveTier } from "../util/segment";
import type { KurumTur } from "../domain/enums";
import type { Lead } from "../domain/types";

export interface SeedRow {
  kurum_adi?: string;
  sehir?: string;
  tur?: string;
  vet_sayisi?: string;
  email?: string;
  website?: string;
  karar_verici?: string;
  kaynak?: string;
}

export type ParsedSeed =
  | { ok: true; lead: Partial<Lead> & { kurumAdi: string } }
  | { ok: false; reason: string };

const VALID_TUR: readonly KurumTur[] = ["muayenehane", "poliklinik", "hastane"];

/** Bir CSV satırını lead alanlarına çevirir + segment/tier türetir (saf, test edilir). */
export function parseSeedRow(row: SeedRow): ParsedSeed {
  const kurumAdi = (row.kurum_adi ?? "").trim();
  if (!kurumAdi) return { ok: false, reason: "kurum_adi boş" };

  const email = (row.email ?? "").trim().toLowerCase() || null;
  if (email && !/.+@.+\..+/.test(email)) return { ok: false, reason: `geçersiz e-posta: ${email}` };

  const turRaw = (row.tur ?? "").trim().toLowerCase();
  const tur = VALID_TUR.includes(turRaw as KurumTur) ? (turRaw as KurumTur) : null;

  const vetRaw = (row.vet_sayisi ?? "").trim();
  const vetSayisi = /^\d+$/.test(vetRaw) ? parseInt(vetRaw, 10) : null;

  const segment = deriveSegment(vetSayisi, tur);
  const tier = deriveTier(segment, tur);

  return {
    ok: true,
    lead: {
      kurumAdi,
      sehir: (row.sehir ?? "").trim() || null,
      tur,
      vetSayisi,
      email,
      website: (row.website ?? "").trim() || null,
      kararVerici: (row.karar_verici ?? "").trim() || null,
      kaynak: (row.kaynak ?? "").trim() || "seed",
      segment,
      tier,
    },
  };
}
