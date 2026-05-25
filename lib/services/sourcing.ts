import { deriveSegment, deriveTier } from "../util/segment";
import type { LeadRepo, PlacesPort, EventRepo } from "../domain/ports";
import type { Candidate } from "../domain/types";

export const DEFAULT_QUERIES = ["veteriner polikliniği", "hayvan hastanesi", "veteriner kliniği"];

export interface SourcingDeps {
  places: PlacesPort;
  leads: LeadRepo;
  events: EventRepo;
}

export function createSourcingService(deps: SourcingDeps) {
  async function persist(candidates: Candidate[]): Promise<number> {
    let n = 0;
    for (const c of candidates) {
      const segment = deriveSegment(null, c.tur);
      const tier = deriveTier(segment, c.tur);
      await deps.leads.upsertCandidate({ ...c, segment, tier });
      n++;
    }
    return n;
  }

  return {
    /** Bir şehir için Places sorgularını çalıştır, tekilleştir, aday olarak kaydet. */
    async sourceCity(
      city: string,
      queries: string[] = DEFAULT_QUERIES,
    ): Promise<{ found: number; upserted: number }> {
      const seen = new Set<string>();
      const candidates: Candidate[] = [];
      for (const q of queries) {
        const res = await deps.places.searchClinics(`${q} ${city}`, { city });
        for (const c of res) {
          const key = c.placeId ?? `${c.kurumAdi}|${c.sehir ?? ""}`;
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push(c);
        }
      }
      const upserted = await persist(candidates);
      await deps.events.log("sourcing", null, { city, found: candidates.length });
      return { found: candidates.length, upserted };
    },

    /** Resmi sicil (TVHB/Bakanlık) CSV satırlarını aday olarak içe al. */
    async ingestRegistry(rows: Candidate[]): Promise<{ upserted: number }> {
      const upserted = await persist(rows);
      await deps.events.log("sourcing_registry", null, { count: rows.length });
      return { upserted };
    },
  };
}
