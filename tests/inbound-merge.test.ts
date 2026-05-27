import { describe, it, expect, vi } from "vitest";
import { createInboundService, type InboundDeps } from "@/lib/services/inbound";
import type { Lead, InboundMessage } from "@/lib/domain/types";

const baseLead = (id: string, email: string, alternates: string[] = []): Lead => ({
  id,
  kurumAdi: "X Polikliniği",
  sehir: null,
  tur: null,
  vetSayisi: null,
  segment: "mid",
  tier: 1,
  email,
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
  alternateEmails: alternates,
});

const corporateMsg: InboundMessage = {
  gmailMessageId: "m1",
  threadId: "t1",
  fromEmail: "info@x-poliklinigi.com.tr",
  subject: "Soru",
  body: "Hangi modülleri sunuyorsunuz?",
  receivedAt: new Date(),
  headerMessageId: null,
};

function makeDeps(
  byEmailResult: Lead | null,
  byDomainResult: Lead | null,
  msg: InboundMessage = corporateMsg,
) {
  return {
    leads: {
      byThread: vi.fn().mockResolvedValue(null),
      byEmail: vi.fn().mockResolvedValue(byEmailResult),
      byDomain: vi.fn().mockResolvedValue(byDomainResult),
      addAlternateEmail: vi.fn().mockResolvedValue(undefined),
      upsertByEmail: vi.fn().mockResolvedValue(baseLead("new", msg.fromEmail)),
      updateDurum: vi.fn(),
      setThread: vi.fn(),
      dueForSend: vi.fn(),
      byId: vi.fn(),
    },
    seq: { get: vi.fn().mockResolvedValue(null), save: vi.fn(), create: vi.fn() },
    supp: { has: vi.fn().mockResolvedValue(false), add: vi.fn() },
    msgs: { add: vi.fn(), existsInbound: vi.fn().mockResolvedValue(false) },
    events: { log: vi.fn() },
    mail: {
      listRecentInbound: vi.fn().mockResolvedValue([msg]),
      createDraft: vi.fn().mockResolvedValue({ id: "d1", threadId: "t1" }),
      send: vi.fn(),
      addLabel: vi.fn(),
      watch: vi.fn(),
    },
    ai: {
      classify: vi.fn().mockResolvedValue({ cls: "fiyat", confidence: 0.9 }),
      writeDraft: vi.fn().mockResolvedValue({ subject: "Re", body: "yanıt" }),
    },
    notify: { hot: vi.fn(), failure: vi.fn() },
  };
}

describe("inbound — lead merge", () => {
  it("kurumsal domain match → mevcut lead'e alternateEmail eklenir, yeni lead yaratılmaz", async () => {
    const existing = baseLead("L1", "owner@x-poliklinigi.com.tr");
    const deps = makeDeps(null, existing);
    await createInboundService(deps as unknown as InboundDeps).handle();
    expect(deps.leads.addAlternateEmail).toHaveBeenCalledWith("L1", "info@x-poliklinigi.com.tr");
    expect(deps.leads.upsertByEmail).not.toHaveBeenCalled();
    expect(deps.events.log).toHaveBeenCalledWith(
      "inbound_lead_merged",
      "L1",
      expect.any(Object),
    );
  });

  it("free-mail domain (gmail) → merge denenmez, yeni lead yaratılır", async () => {
    const freeMailMsg = { ...corporateMsg, fromEmail: "klinik@gmail.com" };
    const deps = makeDeps(null, null, freeMailMsg);
    await createInboundService(deps as unknown as InboundDeps).handle();
    expect(deps.leads.byDomain).not.toHaveBeenCalled();
    expect(deps.leads.upsertByEmail).toHaveBeenCalled();
  });

  it("kurumsal domain ama mevcut lead yok → yeni lead yaratılır", async () => {
    const deps = makeDeps(null, null);
    await createInboundService(deps as unknown as InboundDeps).handle();
    expect(deps.leads.byDomain).toHaveBeenCalledWith("x-poliklinigi.com.tr");
    expect(deps.leads.upsertByEmail).toHaveBeenCalled();
  });
});
