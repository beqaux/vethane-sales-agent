import { describe, it, expect } from "vitest";
import { ClassificationSchema } from "@/lib/domain/schemas";

// ADR-0006 §2.4: schema kontratı + substring guardrail (servis tarafında çalışır)
// — bu dosya sadece schema seviyesi. Hallüsinasyon drop integration testi
// `tests/inbound.test.ts` içinde.

describe("ClassificationSchema", () => {
  it("proposedTime opsiyonel — yokken parse pass", () => {
    const r = ClassificationSchema.parse({ cls: "ilgili", confidence: 0.9 });
    expect(r.proposedTime).toBeUndefined();
  });

  it("proposedTime.raw string min 1, max 80 — geçerli kabul edilir", () => {
    const r = ClassificationSchema.parse({
      cls: "demo",
      confidence: 0.95,
      proposedTime: { raw: "Salı 14:00" },
    });
    expect(r.proposedTime?.raw).toBe("Salı 14:00");
  });

  it("proposedTime.raw boş string → schema reddeder", () => {
    expect(() =>
      ClassificationSchema.parse({
        cls: "demo",
        confidence: 0.9,
        proposedTime: { raw: "" },
      }),
    ).toThrow();
  });

  it("proposedTime.raw > 80 char → reddeder", () => {
    expect(() =>
      ClassificationSchema.parse({
        cls: "demo",
        confidence: 0.9,
        proposedTime: { raw: "a".repeat(81) },
      }),
    ).toThrow();
  });

  it("bilinmeyen field strip edilir veya passthrough (zod default)", () => {
    // Backwards compat: eski çağrılarda proposedTime yok — schema yine geçer.
    const r = ClassificationSchema.parse({
      cls: "fiyat",
      confidence: 0.7,
      segmentGuess: "mid",
      vetCountGuess: 4,
    });
    expect(r.cls).toBe("fiyat");
    expect(r.segmentGuess).toBe("mid");
    expect(r.vetCountGuess).toBe(4);
    expect(r.proposedTime).toBeUndefined();
  });
});
