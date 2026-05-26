import { describe, it, expect, vi } from "vitest";
import {
  extractEmailsFromHtml,
  pickBestEmail,
  domainFromUrl,
  createEnrichmentService,
  type EnrichDeps,
} from "@/lib/services/enrichment";
import type { Lead } from "@/lib/domain/types";

function makeLead(over: Partial<Lead> = {}): Lead {
  return {
    id: "1",
    kurumAdi: "Test Klinik",
    sehir: "İzmir",
    tur: "poliklinik",
    vetSayisi: null,
    segment: "mid",
    tier: 1,
    email: null,
    emailConfidence: null,
    website: "https://klinik.com",
    placeId: "p1",
    phone: null,
    instagram: null,
    kararVerici: null,
    kaynak: "places",
    durum: "aday",
    gmailThreadId: null,
    alternateEmails: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

describe("enrichment (saf)", () => {
  it("extractEmailsFromHtml mailto ve metinden çıkarır", () => {
    const html = `<a href="mailto:info@klinik.com">yaz</a><p>destek@klinik.com bize ulaşın</p>`;
    const e = extractEmailsFromHtml(html);
    expect(e).toContain("info@klinik.com");
    expect(e).toContain("destek@klinik.com");
  });

  it("pickBestEmail domain eşleşeni tercih eder; yoksa info@ önerir; hiç yoksa null", () => {
    expect(pickBestEmail(["a@gmail.com", "info@klinik.com"], "klinik.com")).toEqual({
      email: "info@klinik.com",
      confidence: "high",
    });
    expect(pickBestEmail([], "klinik.com")).toEqual({ email: "info@klinik.com", confidence: "low" });
    expect(pickBestEmail([], null)).toBeNull();
  });

  it("domainFromUrl www'yu atar", () => {
    expect(domainFromUrl("https://www.klinik.com/iletisim")).toBe("klinik.com");
    expect(domainFromUrl("klinik.com")).toBe("klinik.com");
  });
});

describe("enrichLead", () => {
  it("website'ten e-posta bulup setEmail çağırır (high)", async () => {
    const lead = makeLead();
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `<a href="mailto:info@klinik.com">x</a>`,
    });
    const deps = {
      leads: { setEmail: vi.fn().mockResolvedValue(undefined) },
      events: { log: vi.fn().mockResolvedValue(undefined) },
      fetchFn,
    };
    const svc = createEnrichmentService(deps as unknown as EnrichDeps);
    const r = await svc.enrichLead(lead);
    expect(r).toEqual({ email: "info@klinik.com", confidence: "high" });
    expect(deps.leads.setEmail).toHaveBeenCalledWith("1", "info@klinik.com", "high");
  });

  it("website yoksa null döner", async () => {
    const deps = {
      leads: { setEmail: vi.fn() },
      events: { log: vi.fn().mockResolvedValue(undefined) },
      fetchFn: vi.fn(),
    };
    const svc = createEnrichmentService(deps as unknown as EnrichDeps);
    const r = await svc.enrichLead(makeLead({ website: null }));
    expect(r.email).toBeNull();
    expect(deps.leads.setEmail).not.toHaveBeenCalled();
  });
});
