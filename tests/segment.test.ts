import { describe, it, expect } from "vitest";
import { deriveSegment, deriveTier } from "@/lib/util/segment";

describe("deriveSegment", () => {
  it("vet sayısından türetir", () => {
    expect(deriveSegment(6, "hastane")).toBe("hospital");
    expect(deriveSegment(8, null)).toBe("hospital");
    expect(deriveSegment(4, "poliklinik")).toBe("mid");
    expect(deriveSegment(3, "muayenehane")).toBe("mid");
    expect(deriveSegment(2, "muayenehane")).toBe("solo");
    expect(deriveSegment(1, null)).toBe("solo");
  });

  it("vet yoksa türden türetir", () => {
    expect(deriveSegment(null, "hastane")).toBe("hospital");
    expect(deriveSegment(null, "poliklinik")).toBe("mid");
    expect(deriveSegment(null, "muayenehane")).toBe("solo");
  });

  it("ikisi de yoksa unknown", () => {
    expect(deriveSegment(null, null)).toBe("unknown");
    expect(deriveSegment(0, null)).toBe("unknown");
  });

  it("hastane ünvanı + 2 vet → hospital (tür-öncelikli)", () => {
    expect(deriveSegment(2, "hastane")).toBe("hospital");
  });
  it("muayenehane + 3 vet → mid", () => {
    expect(deriveSegment(3, "muayenehane")).toBe("mid");
  });
  it("muayenehane + null vet → solo", () => {
    expect(deriveSegment(null, "muayenehane")).toBe("solo");
  });
  it("poliklinik + 4 vet → mid (taban mid)", () => {
    expect(deriveSegment(4, "poliklinik")).toBe("mid");
  });
  it("poliklinik + 5 vet → hospital", () => {
    expect(deriveSegment(5, "poliklinik")).toBe("hospital");
  });

  // Kullanıcı eşiği: 1-2 solo, 3-4 mid, 5+ hospital (tür yoksa / muayenehane)
  it("vet eşiği 1-2/3-4/5+ → solo/mid/hospital", () => {
    expect(deriveSegment(1, null)).toBe("solo");
    expect(deriveSegment(2, null)).toBe("solo");
    expect(deriveSegment(3, null)).toBe("mid");
    expect(deriveSegment(4, null)).toBe("mid");
    expect(deriveSegment(5, null)).toBe("hospital");
    expect(deriveSegment(10, null)).toBe("hospital");
    // muayenehane de aynı eşiği izler
    expect(deriveSegment(4, "muayenehane")).toBe("mid");
    expect(deriveSegment(5, "muayenehane")).toBe("hospital");
  });
});

describe("deriveTier", () => {
  it("kurumsal (poliklinik/hastane) → Tier 1", () => {
    expect(deriveTier("hospital", "hastane")).toBe(1);
    expect(deriveTier("mid", "poliklinik")).toBe(1);
  });

  it("muayenehane → 3 vet Tier 2, solo Tier 3", () => {
    expect(deriveTier("mid", "muayenehane")).toBe(2);
    expect(deriveTier("solo", "muayenehane")).toBe(3);
  });

  it("tür bilinmiyorsa segmentten (kurumsal varsayar)", () => {
    expect(deriveTier("hospital", null)).toBe(1);
    expect(deriveTier("mid", null)).toBe(1);
    expect(deriveTier("solo", null)).toBe(3);
    expect(deriveTier("unknown", null)).toBe(3);
  });
});
