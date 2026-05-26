import { describe, it, expect, vi } from "vitest";
import { createInboundService, type InboundDeps } from "@/lib/services/inbound";
import type { Lead, InboundMessage } from "@/lib/domain/types";
import type { Classification, Segment } from "@/lib/domain/enums";

function makeLead(segment: Segment = "mid"): Lead {
  return {
    id: "1",
    kurumAdi: "Test",
    sehir: "İzmir",
    tur: null,
    vetSayisi: segment === "solo" ? 1 : 4,
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
    gmailThreadId: "t1",
    alternateEmails: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const msg: InboundMessage = {
  gmailMessageId: "g1",
  threadId: "t1",
  fromEmail: "a@b.com",
  subject: "Konu",
  body: "merhaba",
  receivedAt: new Date(),
};

function makeDeps(opts: {
  cls: Classification;
  confidence?: number;
  aiBody?: string;
  segment?: Segment;
  lead?: Lead | null;
  existsInbound?: boolean;
}) {
  const lead = opts.lead === undefined ? makeLead(opts.segment ?? "mid") : opts.lead;
  return {
    leads: {
      byThread: vi.fn().mockResolvedValue(lead),
      byEmail: vi.fn().mockResolvedValue(lead),
      byDomain: vi.fn().mockResolvedValue(null),
      addAlternateEmail: vi.fn().mockResolvedValue(undefined),
      updateDurum: vi.fn().mockResolvedValue(undefined),
      setThread: vi.fn().mockResolvedValue(undefined),
      dueForSend: vi.fn(),
      byId: vi.fn(),
      upsertByEmail: vi
        .fn()
        .mockResolvedValue(makeLead(opts.segment ?? "mid")),
    },
    seq: {
      get: vi.fn().mockResolvedValue({
        leadId: "1",
        currentStep: 1,
        nextActionAt: new Date(),
        lastSentAt: null,
        status: "active",
      }),
      save: vi.fn().mockResolvedValue(undefined),
      create: vi.fn(),
    },
    supp: { has: vi.fn().mockResolvedValue(false), add: vi.fn().mockResolvedValue(undefined) },
    msgs: {
      add: vi.fn().mockResolvedValue(undefined),
      existsInbound: vi.fn().mockResolvedValue(opts.existsInbound ?? false),
    },
    events: { log: vi.fn().mockResolvedValue(undefined) },
    mail: {
      listRecentInbound: vi.fn().mockResolvedValue([msg]),
      createDraft: vi.fn().mockResolvedValue({ id: "d1", threadId: "t1" }),
      send: vi.fn().mockResolvedValue("m1"),
      addLabel: vi.fn().mockResolvedValue(undefined),
      watch: vi.fn(),
    },
    ai: {
      classify: vi.fn().mockResolvedValue({ cls: opts.cls, confidence: opts.confidence ?? 0.9 }),
      writeDraft: vi.fn().mockResolvedValue({ subject: "Re", body: opts.aiBody ?? "yanıt" }),
    },
    notify: { hot: vi.fn().mockResolvedValue(undefined) },
  };
}

const run = (deps: ReturnType<typeof makeDeps>) =>
  createInboundService(deps as unknown as InboundDeps).handle();

describe("InboundService.handle", () => {
  it("demo → bildirim + durum demo_istedi + yanıt taslağı + sekans durur", async () => {
    const deps = makeDeps({ cls: "demo", aiBody: "Demo için uygun zamanınız?" });
    await run(deps);
    expect(deps.notify.hot).toHaveBeenCalled();
    expect(deps.leads.updateDurum).toHaveBeenCalledWith("1", "demo_istedi");
    expect(deps.mail.createDraft).toHaveBeenCalled();
    expect(deps.seq.save).toHaveBeenCalled();
  });

  it("cikis → suppression + durum cikti", async () => {
    const deps = makeDeps({ cls: "cikis", aiBody: "Sizi listeden çıkardım, kolay gelsin." });
    await run(deps);
    expect(deps.supp.add).toHaveBeenCalled();
    expect(deps.leads.updateDurum).toHaveBeenCalledWith("1", "cikti");
  });

  it("ilgisiz → taslak YOK, durum kaybedildi", async () => {
    const deps = makeDeps({ cls: "ilgisiz" });
    await run(deps);
    expect(deps.mail.createDraft).not.toHaveBeenCalled();
    expect(deps.leads.updateDurum).toHaveBeenCalledWith("1", "kaybedildi");
  });

  it("mid + fiyat → temiz pivot taslağı + premium bildirim (createDraft)", async () => {
    const deps = makeDeps({
      cls: "fiyat",
      segment: "mid",
      aiBody: "Klinik büyüklüğüne göre değişiyor, kısa bir demoda netleştirelim.",
    });
    await run(deps);
    expect(deps.mail.createDraft).toHaveBeenCalled();
    expect(deps.notify.hot).toHaveBeenCalled();
  });

  it("mid + fiyat'ta AI fiyat sızdırırsa guardrail engeller (createDraft YOK)", async () => {
    const deps = makeDeps({ cls: "fiyat", segment: "mid", aiBody: "Aylık 11.370 TL." });
    await run(deps);
    expect(deps.mail.createDraft).not.toHaveBeenCalled();
    expect(deps.events.log).toHaveBeenCalledWith(
      "guardrail_block",
      "1",
      expect.objectContaining({ action: "mid_reply" }),
    );
  });

  it("dedup: existsInbound true → işlem yok", async () => {
    const deps = makeDeps({ cls: "demo", existsInbound: true });
    await run(deps);
    expect(deps.ai.classify).not.toHaveBeenCalled();
    expect(deps.mail.createDraft).not.toHaveBeenCalled();
  });

  it("lead yoksa → yeni lead yaratılır + inbound_new_lead event", async () => {
    const deps = makeDeps({ cls: "demo", lead: null });
    await run(deps);
    expect(deps.leads.upsertByEmail).toHaveBeenCalled();
    expect(deps.events.log).toHaveBeenCalledWith(
      "inbound_new_lead",
      expect.any(String),
      expect.objectContaining({ from: "a@b.com" }),
    );
  });

  it("düşük confidence (<0.5) → auto-mode bypass, mail.send çağrılmaz", async () => {
    const deps = makeDeps({
      cls: "fiyat",
      confidence: 0.3,
      segment: "solo",
      aiBody: "Aylık taban 1.950 ₺ + KDV...",
    });
    await run(deps);
    expect(deps.mail.createDraft).toHaveBeenCalled();
    expect(deps.mail.send).not.toHaveBeenCalled();
    expect(deps.notify.hot).toHaveBeenCalled();
  });

  it("notify.hot çağrısı zengin enrichment içerir (cls)", async () => {
    const deps = makeDeps({ cls: "demo", segment: "mid", confidence: 0.9 });
    await run(deps);
    expect(deps.notify.hot).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({ cls: expect.objectContaining({ cls: "demo" }) }),
    );
  });
});
