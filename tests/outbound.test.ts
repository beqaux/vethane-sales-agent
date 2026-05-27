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
    notify: {
      hot: vi.fn().mockResolvedValue(undefined),
      failure: vi.fn().mockResolvedValue(undefined),
      demoTimeApproval: vi.fn(),
      coldDraftApproval: vi.fn().mockResolvedValue({ chatId: "12345", messageId: 11 }),
      uncertainReplyApproval: vi.fn(),
    },
    pendingActions: {
      create: vi.fn().mockImplementation(async (i: { id?: string }) => ({
        pending: { id: i.id ?? "p-x" },
        tokenPrefix: (i.id ?? "p-x").slice(0, 8),
      })),
      resolve: vi.fn().mockResolvedValue(true),
      updatePayload: vi.fn(),
      expireDue: vi.fn(),
      tokenPrefix: (id: string) => id.slice(0, 8),
    },
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

  // ADR-0006 §2.1 akış #1
  it("mid_cold (manuel) → pending_action 'send_draft' + coldDraftApproval 3-buton", async () => {
    const deps = makeDeps("Merhaba, kısa bir demo ayarlayalım mı?");
    const svc = createOutboundService(deps as unknown as OutboundDeps);
    await svc.processDue();
    expect(deps.notify.coldDraftApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        lead: expect.any(Object),
        threadId: "t1",
        subject: "S",
        body: expect.any(String),
        currentStep: 0,
        tokenPrefix: expect.any(String),
      }),
    );
    expect(deps.pendingActions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "send_draft",
        leadId: "1",
        gmailDraftId: "d1",
        gmailThreadId: "t1",
        payload: expect.objectContaining({
          action: "mid_cold",
          telegram: { chatId: "12345", messageId: 11 },
        }),
      }),
    );
    expect(deps.mail.send).not.toHaveBeenCalled(); // manual mode
    expect(deps.events.log).toHaveBeenCalledWith(
      "cold_draft_pending",
      "1",
      expect.objectContaining({ action: "mid_cold", draftId: "d1" }),
    );
  });

  it("hospital_cold (manuel) → aynı pending + 3-buton akışı", async () => {
    const lead = makeLead({
      segment: "hospital",
      vetSayisi: 8,
      tur: "hastane",
      kurumAdi: "X Hastanesi",
    });
    const deps = makeDeps("Demo ayarlayalım mı?", lead);
    const svc = createOutboundService(deps as unknown as OutboundDeps);
    await svc.processDue();
    expect(deps.notify.coldDraftApproval).toHaveBeenCalled();
    expect(deps.pendingActions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "send_draft",
        payload: expect.objectContaining({ action: "hospital_cold" }),
      }),
    );
  });

  it("auto mid_takip → coldDraftApproval ATILMAZ (sadece manuel cold için)", async () => {
    const lead = makeLead();
    const seqStep1 = { ...seqState, currentStep: 1 };
    const deps = makeDeps("Takip", lead);
    deps.leads.dueForSend = vi
      .fn()
      .mockResolvedValue([{ ...lead, seq: seqStep1 }]);
    const svc = createOutboundService(deps as unknown as OutboundDeps);
    await svc.processDue();
    expect(deps.notify.coldDraftApproval).not.toHaveBeenCalled();
    expect(deps.pendingActions.create).not.toHaveBeenCalled();
  });

  it("coldDraftApproval notify fail → pending YOK (data integrity)", async () => {
    const deps = makeDeps("Demo?");
    deps.notify.coldDraftApproval = vi.fn().mockResolvedValue(null);
    const svc = createOutboundService(deps as unknown as OutboundDeps);
    await svc.processDue();
    expect(deps.pendingActions.create).not.toHaveBeenCalled();
    // Gmail draft hala oluştu — kurucu manuel atabilir.
    expect(deps.mail.createDraft).toHaveBeenCalled();
  });
});
