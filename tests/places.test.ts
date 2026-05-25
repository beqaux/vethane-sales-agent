import { describe, it, expect } from "vitest";
import { inferTur, mapPlaceToCandidate } from "@/lib/adapters/places";

describe("places mapping (saf)", () => {
  it("inferTur kurum adından türetir (hastane > poliklinik > muayenehane)", () => {
    expect(inferTur("Özlem Veteriner Hastanesi")).toBe("hastane");
    expect(inferTur("Bursa Hayvan Polikliniği")).toBe("poliklinik");
    expect(inferTur("Pati Veteriner Kliniği")).toBe("muayenehane");
    expect(inferTur("Minik Dostlar Veteriner")).toBe("muayenehane");
    expect(inferTur("Rastgele Şirket A.Ş.")).toBeNull();
  });

  it("mapPlaceToCandidate alanları doğru maplar", () => {
    const c = mapPlaceToCandidate(
      {
        id: "p1",
        displayName: { text: "X Hayvan Hastanesi" },
        websiteUri: "https://x.com",
        nationalPhoneNumber: "0212 000 0000",
      },
      "İstanbul",
    );
    expect(c).toMatchObject({
      kurumAdi: "X Hayvan Hastanesi",
      placeId: "p1",
      website: "https://x.com",
      phone: "0212 000 0000",
      sehir: "İstanbul",
      tur: "hastane",
      kaynak: "places",
    });
  });

  it("eksik alanlar null'a düşer", () => {
    const c = mapPlaceToCandidate({ id: "p2", displayName: { text: "Test Kliniği" } }, null);
    expect(c.website).toBeNull();
    expect(c.phone).toBeNull();
    expect(c.sehir).toBeNull();
    expect(c.tur).toBe("muayenehane");
  });
});
