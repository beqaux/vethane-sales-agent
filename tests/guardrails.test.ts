import { describe, it, expect } from "vitest";
import {
  runGuardrails,
  noPriceForBigSegment,
  noPromises,
  noBannedPhrasesOrTime,
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

describe("noBannedPhrasesOrTime", () => {
  it("'Tüm sistem — harika' (em-dash) reddeder", () => {
    expect(noBannedPhrasesOrTime(draft({ body: "Tüm sistem — harika!" }), ctx()).ok).toBe(false);
  });
  it("tire/dash varyasyonları da reddedilir", () => {
    expect(noBannedPhrasesOrTime(draft({ body: "Tüm sistem - harika" }), ctx()).ok).toBe(false);
    expect(noBannedPhrasesOrTime(draft({ body: "Tüm sistem harika" }), ctx()).ok).toBe(false);
  });
  it("'Handaki' gibberish reddeder", () => {
    expect(noBannedPhrasesOrTime(draft({ body: "Handaki 1-2 veterinerli yapınız" }), ctx()).ok).toBe(false);
  });
  it("yapay kalıp ('kliniğinize tam uyumlu olup olmadığını') reddeder", () => {
    expect(
      noBannedPhrasesOrTime(draft({ body: "kliniğinize tam uyumlu olup olmadığını görelim" }), ctx()).ok,
    ).toBe(false);
  });
  it("mid_reply'da uydurma somut saat ('Çarşamba 10:00') reddeder", () => {
    expect(
      noBannedPhrasesOrTime(draft({ action: "mid_reply", body: "Çarşamba 10:00 uygun mu?" }), ctx()).ok,
    ).toBe(false);
    expect(
      noBannedPhrasesOrTime(draft({ action: "mid_reply", body: "saat 15 demo yapalım" }), ctx()).ok,
    ).toBe(false);
  });
  it("mid_reply sadece müsaitlik SORARSA geçer (saat yok)", () => {
    expect(
      noBannedPhrasesOrTime(
        draft({ action: "mid_reply", body: "Hangi tarihler size uygun, demo gösterelim?" }),
        ctx(),
      ).ok,
    ).toBe(true);
  });
  it("demo_reply müşterinin saatini EKO edebilir → engellenmez (HH:MM serbest)", () => {
    // ADR-0006 §2.4: demo_reply müşterinin önerdiği saati teyiden yazabilir.
    expect(
      noBannedPhrasesOrTime(draft({ action: "demo_reply", body: "Pazartesi 15:30 için not aldım." }), ctx()).ok,
    ).toBe(true);
  });
  it("solo_fiyat saat-kuralından etkilenmez (sadece demo/mid/hospital ask)", () => {
    expect(
      noBannedPhrasesOrTime(draft({ action: "solo_fiyat", body: "saat 15 civarı uygun" }), ctx()).ok,
    ).toBe(true);
  });
  it("temiz metin geçer", () => {
    expect(noBannedPhrasesOrTime(draft({ body: "Kısa bir demo ayarlayalım mı?" }), ctx()).ok).toBe(true);
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
  it("banned phrase içeren taslak zincirde reddedilir", () => {
    const r = runGuardrails(
      draft({ segment: "mid", body: `Tüm sistem — harika!\n${BRAND.optOutText}` }),
      ctx(),
    );
    expect(r.ok).toBe(false);
  });
});
