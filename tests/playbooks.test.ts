import { describe, it, expect } from "vitest";
import { playbookFor } from "@/lib/playbooks";
import type { Lead, InboundMessage } from "@/lib/domain/types";
import type { Segment } from "@/lib/domain/enums";

function lead(segment: Segment): Lead {
  return {
    id: "1",
    kurumAdi: "Test",
    sehir: "İzmir",
    tur: null,
    vetSayisi: segment === "solo" ? 1 : segment === "mid" ? 4 : 6,
    segment,
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
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const msg: InboundMessage = {
  gmailMessageId: "m1",
  threadId: "t1",
  fromEmail: "a@b.com",
  subject: "konu",
  body: "merhaba",
  receivedAt: new Date(),
};

describe("playbook — outbound", () => {
  it("mid/hospital outbound FİYAT içermez (includePrice/priceText yok)", () => {
    const mid = playbookFor("mid").buildOutbound(lead("mid"), 0);
    expect(mid.action).toBe("mid_cold");
    expect(mid.isCold).toBe(true);
    expect(mid.includePrice).toBeFalsy();
    expect(mid.priceText).toBeUndefined();

    const hosp = playbookFor("hospital").buildOutbound(lead("hospital"), 0);
    expect(hosp.priceText).toBeUndefined();
  });

  it("solo outbound takip step>0", () => {
    expect(playbookFor("solo").buildOutbound(lead("solo"), 1).action).toBe("solo_takip");
  });

  it("unknown segment → mid davranışı (fiyatsız, güvenli)", () => {
    const spec = playbookFor("unknown").buildOutbound(lead("mid"), 0);
    expect(spec.segment).toBe("mid");
    expect(spec.priceText).toBeUndefined();
  });
});

describe("playbook — reply", () => {
  it("solo + fiyat → fiyat içerir (config'ten)", () => {
    const r = playbookFor("solo").buildReply(lead("solo"), msg, "fiyat");
    expect(r.includePrice).toBe(true);
    expect(r.priceText).toMatch(/₺/);
    expect(r.sendDraft).toBe(true);
  });

  it("mid + fiyat → FİYAT YOK, demoya pivot + bildirim", () => {
    const r = playbookFor("mid").buildReply(lead("mid"), msg, "fiyat");
    expect(r.includePrice).toBeFalsy();
    expect(r.priceText).toBeUndefined();
    expect(r.notify).toBe(true);
    expect(r.sendDraft).toBe(true);
  });

  it("hospital + fiyat → FİYAT YOK", () => {
    const r = playbookFor("hospital").buildReply(lead("hospital"), msg, "fiyat");
    expect(r.priceText).toBeUndefined();
  });

  it("demo → bildirim + durum demo_istedi + stop", () => {
    const r = playbookFor("mid").buildReply(lead("mid"), msg, "demo");
    expect(r.notify).toBe(true);
    expect(r.newDurum).toBe("demo_istedi");
    expect(r.stopSequence).toBe(true);
  });

  it("cikis → suppress + stop + durum cikti", () => {
    const r = playbookFor("solo").buildReply(lead("solo"), msg, "cikis");
    expect(r.suppress).toBe(true);
    expect(r.stopSequence).toBe(true);
    expect(r.newDurum).toBe("cikti");
  });

  it("ilgisiz → taslak yok, durum kaybedildi", () => {
    const r = playbookFor("mid").buildReply(lead("mid"), msg, "ilgisiz");
    expect(r.sendDraft).toBe(false);
    expect(r.newDurum).toBe("kaybedildi");
  });

  it("oto_yanit → taslak yok, ertele", () => {
    const r = playbookFor("mid").buildReply(lead("mid"), msg, "oto_yanit");
    expect(r.sendDraft).toBe(false);
    expect(r.rescheduleDays).toBeGreaterThan(0);
    expect(r.stopSequence).toBe(false);
  });
});
