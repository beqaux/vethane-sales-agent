import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildUserPrompt, PRICE_BAN_MARKER } from "@/lib/ai/prompts";
import { getKnowledge } from "@/lib/ai/knowledge";
import type { DraftRequest, Lead } from "@/lib/domain/types";
import type { Segment } from "@/lib/domain/enums";

function lead(segment: Segment): Lead {
  return {
    id: "1",
    kurumAdi: "Test Klinik",
    sehir: "İzmir",
    tur: null,
    vetSayisi: null,
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
    durum: "yeni",
    gmailThreadId: null,
    alternateEmails: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function req(segment: Segment, extra: Partial<DraftRequest> = {}): DraftRequest {
  return {
    segment,
    isReply: false,
    isCold: true,
    goal: "g",
    guidance: "gd",
    lead: lead(segment),
    knowledge: getKnowledge(),
    ...extra,
  };
}

describe("prompt builder — fiyat guardrail (1. katman)", () => {
  it("mid ve hospital sistem prompt'unda fiyat yasağı VAR", () => {
    expect(buildSystemPrompt(req("mid"))).toContain(PRICE_BAN_MARKER);
    expect(buildSystemPrompt(req("hospital"))).toContain(PRICE_BAN_MARKER);
  });

  it("solo sistem prompt'unda fiyat yasağı YOK", () => {
    expect(buildSystemPrompt(req("solo"))).not.toContain(PRICE_BAN_MARKER);
  });

  it("solo + priceText fiyatı prompt'a koyar (kopyala-yapıştır talimatıyla)", () => {
    const s = buildSystemPrompt(req("solo", { priceText: "4.160 ₺ + KDV" }));
    expect(s).toContain("4.160 ₺ + KDV");
    expect(s).toContain("KOPYALA-YAPIŞTIR");
    expect(s).toContain("Sayı UYDURMA");
  });

  it("cold mail user prompt'unda ilk temas işareti ve opt-out talimatı", () => {
    expect(buildUserPrompt(req("mid"))).toContain("İLK temas");
    expect(buildSystemPrompt(req("mid", { isCold: true }))).toContain("opt-out");
  });
});
