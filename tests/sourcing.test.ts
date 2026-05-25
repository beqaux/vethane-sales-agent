import { describe, it, expect, vi } from "vitest";
import { createSourcingService, type SourcingDeps } from "@/lib/services/sourcing";
import type { Candidate } from "@/lib/domain/types";
import type { KurumTur } from "@/lib/domain/enums";

function cand(placeId: string, tur: KurumTur | null = "poliklinik"): Candidate {
  return {
    kurumAdi: `Klinik ${placeId}`,
    sehir: "İzmir",
    tur,
    website: null,
    phone: null,
    placeId,
    kaynak: "places",
  };
}

function deps(searchMock: ReturnType<typeof vi.fn>) {
  return {
    places: { searchClinics: searchMock },
    leads: { upsertCandidate: vi.fn().mockResolvedValue({}) },
    events: { log: vi.fn().mockResolvedValue(undefined) },
  };
}

describe("sourcing", () => {
  it("sorgular arası placeId ile tekilleştirir", async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce([cand("p1"), cand("p2")])
      .mockResolvedValueOnce([cand("p1"), cand("p3")]) // p1 tekrar
      .mockResolvedValue([]);
    const d = deps(search);
    const svc = createSourcingService(d as unknown as SourcingDeps);
    const r = await svc.sourceCity("İzmir");
    expect(r.found).toBe(3);
    expect(d.leads.upsertCandidate).toHaveBeenCalledTimes(3);
  });

  it("poliklinik adayına segment=mid, tier=1 türetir", async () => {
    const search = vi.fn().mockResolvedValueOnce([cand("p1", "poliklinik")]).mockResolvedValue([]);
    const d = deps(search);
    const svc = createSourcingService(d as unknown as SourcingDeps);
    await svc.sourceCity("İzmir");
    expect(d.leads.upsertCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ segment: "mid", tier: 1, placeId: "p1" }),
    );
  });

  it("ingestRegistry sicil satırlarını kaydeder", async () => {
    const d = deps(vi.fn());
    const svc = createSourcingService(d as unknown as SourcingDeps);
    const r = await svc.ingestRegistry([cand("r1", "hastane")]);
    expect(r.upserted).toBe(1);
    expect(d.leads.upsertCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ segment: "hospital", tier: 1 }),
    );
  });
});
