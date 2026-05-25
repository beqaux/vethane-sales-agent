import { describe, it, expect } from "vitest";
import { parseSeedRow } from "@/lib/services/import";

describe("parseSeedRow", () => {
  it("geçerli satır → segment/tier türetir, e-postayı küçük harfler", () => {
    const r = parseSeedRow({ kurum_adi: "X Hastanesi", tur: "hastane", vet_sayisi: "7", email: "INFO@x.com" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lead.segment).toBe("hospital");
      expect(r.lead.tier).toBe(1);
      expect(r.lead.email).toBe("info@x.com");
      expect(r.lead.kaynak).toBe("seed");
    }
  });

  it("3 vet muayenehane → mid / tier 2", () => {
    const r = parseSeedRow({ kurum_adi: "Y", tur: "muayenehane", vet_sayisi: "3" });
    expect(r.ok && r.lead.segment).toBe("mid");
    expect(r.ok && r.lead.tier).toBe(2);
  });

  it("boş kurum_adi → hata", () => {
    expect(parseSeedRow({}).ok).toBe(false);
  });

  it("geçersiz e-posta → hata", () => {
    expect(parseSeedRow({ kurum_adi: "X", email: "bozuk" }).ok).toBe(false);
  });

  it("bilinmeyen tür → tur null (segment unknown)", () => {
    const r = parseSeedRow({ kurum_adi: "X", tur: "xyz" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lead.tur).toBeNull();
      expect(r.lead.segment).toBe("unknown");
    }
  });
});
