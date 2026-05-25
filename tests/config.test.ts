import { describe, it, expect } from "vitest";
import { getSoloPrice, expansionDiscount, formatTRY } from "@/lib/config/pricing";

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
