import { describe, it, expect } from "vitest";
import {
  getSoloPrice,
  expansionDiscount,
  formatTRY,
  getMidPrice,
  getHospitalPrice,
} from "@/lib/config/pricing";

describe("getSoloPrice (deterministik, tek gerçek kaynak)", () => {
  it("taban + 1 vet + Muhasebe = 4160", () => {
    expect(getSoloPrice({ modules: ["muhasebe"], vetCount: 1 }).total).toBe(4160);
  });

  it("solo full (muhasebe+ik+analitik) + 1 vet = 6305 (%10 indirim)", () => {
    expect(getSoloPrice({ modules: ["muhasebe", "ik", "analitik"], vetCount: 1 }).total).toBe(6305);
  });

  it("modülsüz taban + 2 vet = 2470", () => {
    expect(getSoloPrice({ modules: [], vetCount: 2 }).total).toBe(1950 + 520);
  });

  it("expansion indirim kademeleri", () => {
    expect(expansionDiscount(1)).toBe(0);
    expect(expansionDiscount(2)).toBe(0.05);
    expect(expansionDiscount(3)).toBe(0.1);
    expect(expansionDiscount(4)).toBe(0.15);
  });

  it("formatTRY KDV hariç gösterir", () => {
    expect(formatTRY(4160)).toContain("KDV");
  });
});

describe("pricing — mid/hospital reference tables", () => {
  it("mid 4 vet + 3 modül -%10 ≈ 11.370 (PRICING.md §5)", () => {
    const r = getMidPrice({ modules: ["muhasebe", "ik", "analitik"], vetCount: 4 });
    // 3200 + 4*220 + (3300+2800+2000)*0.9 = 4080 + 7290 = 11370
    expect(r.total).toBe(11370);
  });

  it("hospital 6 vet + 4 modül -%15 ≈ 22.125 (PRICING.md §5)", () => {
    const r = getHospitalPrice({
      modules: ["muhasebe", "ik", "analitik", "kafe"],
      vetCount: 6,
    });
    // 5400 + 6*195 + (7000+5800+4100+1400)*0.85 = 6570 + 15555 = 22125
    expect(r.total).toBe(22125);
  });
});
