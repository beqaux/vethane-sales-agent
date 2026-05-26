import { describe, it, expect } from "vitest";
import {
  runGuardrails,
  noPriceForBigSegment,
  noPromises,
  requireOptOut,
  suppressionCheck,
} from "@/lib/guardrails";
import { BRAND } from "@/lib/config/runtime";
import type { OutboundDraft, GuardCtx, Lead } from "@/lib/domain/types";

function makeLead(): Lead {
  return {
    id: "1",
    kurumAdi: "X",
    sehir: null,
    tur: null,
    vetSayisi: null,
    segment: "mid",
    tier: 1,
    email: "a@b.com",
    emailConfidence: null,
    website: null,
    placeId: null,
    phone: null,
    instagram: null,
    kararVerici: null,
    kaynak: null,
    durum: "sekansta",
    gmailThreadId: null,
    alternateEmails: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function draft(over: Partial<OutboundDraft> = {}): OutboundDraft {
  return {
    subject: "Konu",
    body: `Merhaba, kısa bir demo ayarlayalım mı?\n\n${BRAND.optOutText}`,
    segment: "mid",
    isCold: true,
    action: "mid_cold",
    toEmail: "a@b.com",
    ...over,
  };
}

const ctx = (suppressed = false): GuardCtx => ({ lead: makeLead(), suppressed });

describe("noPriceForBigSegment (KRİTİK)", () => {
  const priceVariants = [
    "Aylık 11.370₺ tutuyor",
    "11370 TL civarı",
    "Fiyat ₺11.370",
    "Yaklaşık 11.370 TL + KDV",
    "Aylık 11370 lira",
    "TL 11370 gibi",
  ];

  for (const variant of priceVariants) {
    it(`mid taslağında reddeder: "${variant}"`, () => {
      const r = noPriceForBigSegment(draft({ segment: "mid", body: variant }), ctx());
      expect(r.ok).toBe(false);
    });
  }

  it("hospital taslağında da reddeder", () => {
    expect(noPriceForBigSegment(draft({ segment: "hospital", body: "₺22.125" }), ctx()).ok).toBe(
      false,
    );
  });

  it("solo'da fiyat SERBEST (guard sadece mid/hospital)", () => {
    expect(noPriceForBigSegment(draft({ segment: "solo", body: "4.160 ₺ + KDV" }), ctx()).ok).toBe(
      true,
    );
  });

  it("mid'de fiyatsız metin geçer", () => {
    expect(noPriceForBigSegment(draft({ segment: "mid", body: "Demo ayarlayalım" }), ctx()).ok).toBe(
      true,
    );
  });
});

describe("noPromises", () => {
  it("indirim/garanti/taahhüt/yüzde reddeder", () => {
    expect(noPromises(draft({ body: "%10 indirim yaparım" }), ctx()).ok).toBe(false);
    expect(noPromises(draft({ body: "memnuniyet garantisi" }), ctx()).ok).toBe(false);
    expect(noPromises(draft({ body: "size taahhüt veriyoruz" }), ctx()).ok).toBe(false);
  });
  it("temiz metin geçer", () => {
    expect(noPromises(draft({ body: "Kısa bir demo?" }), ctx()).ok).toBe(true);
  });
});

describe("requireOptOut", () => {
  it("cold mailde opt-out yoksa reddeder", () => {
    expect(requireOptOut(draft({ isCold: true, body: "Merhaba" }), ctx()).ok).toBe(false);
  });
  it("cold mailde opt-out varsa geçer", () => {
    expect(requireOptOut(draft({ isCold: true }), ctx()).ok).toBe(true);
  });
  it("cevap (isCold false) opt-out gerektirmez", () => {
    expect(requireOptOut(draft({ isCold: false, body: "Teşekkürler" }), ctx()).ok).toBe(true);
  });
});

describe("suppressionCheck", () => {
  it("suppressed → reddeder", () => {
    expect(suppressionCheck(draft(), ctx(true)).ok).toBe(false);
  });
  it("temiz → geçer", () => {
    expect(suppressionCheck(draft(), ctx(false)).ok).toBe(true);
  });
});

describe("runGuardrails (pipeline)", () => {
  it("geçerli mid cold taslak geçer", () => {
    expect(runGuardrails(draft({ segment: "mid" }), ctx()).ok).toBe(true);
  });
  it("fiyatlı mid taslak reddedilir", () => {
    const r = runGuardrails(draft({ segment: "mid", body: `11.370 TL\n${BRAND.optOutText}` }), ctx());
    expect(r.ok).toBe(false);
  });
  it("suppression ilk sırada engeller", () => {
    expect(runGuardrails(draft(), ctx(true)).ok).toBe(false);
  });
});
