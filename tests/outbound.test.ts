import { describe, it, expect, vi } from "vitest";
import { createOutboundService, type OutboundDeps } from "@/lib/services/outbound";
import type { Lead, SequenceState } from "@/lib/domain/types";
import { RUNTIME } from "@/lib/config/runtime";
import { WARMUP } from "@/lib/config/warmup";

function makeLead(over: Partial<Lead> = {}): Lead {
  return {
    id: "1",
    kurumAdi: "Test Poliklinik",
    sehir: "İzmir",
    tur: "poliklinik",
    vetSayisi: 4,
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
    durum: "yeni",
    gmailThreadId: null,
    alternateEmails: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

const seqState: SequenceState = {
  leadId: "1",
  currentStep: 0,
  nextActionAt: new Date(0),
  lastSentAt: null,
  status: "active",
};

function makeDeps(aiBody: string, lead = makeLead()) {
  return {
    leads: {
      dueForSend: vi.fn().mockResolvedValue([{ ...lead, seq: seqState }]),
      byId: vi.fn(),
      byEmail: vi.fn(),
      byThread: vi.fn(),
      upsertByEmail: vi.fn(),
      updateDurum: vi.fn().mockResolvedValue(undefined),
      setThread: vi.fn().mockResolvedValue(undefined),
    },
    seq: { get: vi.fn(), save: vi.fn().mockResolvedValue(undefined), create: vi.fn() },
    supp: { has: vi.fn().mockResolvedValue(false), add: vi.fn() },
    msgs: { add: vi.fn().mockResolvedValue(undefined) },
    events: { log: vi.fn().mockResolvedValue(undefined) },
    mail: {
      createDraft: vi.fn().mockResolvedValue({ id: "d1", threadId: "t1" }),
      send: vi.fn().mockResolvedValue("m1"),
      addLabel: vi.fn().mockResolvedValue(undefined),
      listHistory: vi.fn(),
      watch: vi.fn(),
    },
    ai: { writeDraft: vi.fn().mockResolvedValue({ subject: "S", body: aiBody }), classify: vi.fn() },
    notify: { hot: vi.fn().mockResolvedValue(undefined), failure: vi.fn().mockResolvedValue(undefined) },
  };
}

describe("OutboundService.processDue", () => {
  it("temiz mid taslak → createDraft, manual modda send YOK, sekans ilerler", async () => {
    const deps = makeDeps("Merhaba, kısa bir demo ayarlayalım mı?");
    const svc = createOutboundService(deps as unknown as OutboundDeps);
    const res = await svc.processDue();

    expect(res.sent).toBe(1);
    expect(res.blocked).toBe(0);
    expect(deps.mail.createDraft).toHaveBeenCalledTimes(1);
    expect(deps.mail.send).not.toHaveBeenCalled(); // manual mode
    expect(deps.seq.save).toHaveBeenCalledTimes(1);
    expect(deps.leads.setThread).toHaveBeenCalledWith("1", "t1");
    expect(deps.leads.updateDurum).toHaveBeenCalledWith("1", "sekansta");
  });

  it("mid taslağında fiyat sızarsa guardrail engeller (createDraft YOK)", async () => {
    const deps = makeDeps("Aylık yaklaşık 11.370 TL tutuyor.");
    const svc = createOutboundService(deps as unknown as OutboundDeps);
    const res = await svc.processDue();

    expect(res.blocked).toBe(1);
    expect(res.sent).toBe(0);
    expect(deps.mail.createDraft).not.toHaveBeenCalled();
    expect(deps.events.log).toHaveBeenCalledWith(
      "guardrail_block",
      "1",
      expect.objectContaining({ action: "mid_cold" }),
    );
    // ADR-0006 §2.3 — guardrail block → Telegram failure notify.
    expect(deps.notify.failure).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "guardrail",
        action: "mid_cold",
        reason: expect.any(String),
      }),
    );
  });

  it("auto mid_takip (ADR-0006 flip): mail.send çağrılır, notify YOK", async () => {
    // mid_takip artık auto: step=1 (takip), mid segment'inde send tetiklenmeli,
    // ama hot/failure notify tetiklenmemeli (sessiz auto).
    const lead = makeLead();
    const seqStep1 = { ...seqState, currentStep: 1 };
    const deps = makeDeps("Geçen mailimi gördünüz mü?", lead);
    deps.leads.dueForSend = vi
      .fn()
      .mockResolvedValue([{ ...lead, seq: seqStep1 }]);
    const svc = createOutboundService(deps as unknown as OutboundDeps);
    const res = await svc.processDue();
    expect(res.sent).toBe(1);
    expect(deps.mail.send).toHaveBeenCalledTimes(1);
    expect(deps.notify.hot).not.toHaveBeenCalled();
    expect(deps.notify.failure).not.toHaveBeenCalled();
  });

  it("dueForSend doğru tier ve cap ile çağrılır", async () => {
    const deps = makeDeps("Demo?");
    const svc = createOutboundService(deps as unknown as OutboundDeps);
    await svc.processDue();
    expect(deps.leads.dueForSend).toHaveBeenCalledWith(
      expect.any(Date),
      RUNTIME.activeTiers,
      WARMUP.startCap,
    );
  });
});
