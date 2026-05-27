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
  headerMessageId: "<msg-1@gmail.com>",
};

function makeDeps(opts: {
  cls: Classification;
  confidence?: number;
  aiBody?: string;
  segment?: Segment;
  lead?: Lead | null;
  existsInbound?: boolean;
  vetCountGuess?: number;
  proposedTime?: { raw: string };
}) {
  const lead = opts.lead === undefined ? makeLead(opts.segment ?? "mid") : opts.lead;
  return {
    leads: {
      byThread: vi.fn().mockResolvedValue(lead),
      byEmail: vi.fn().mockResolvedValue(lead),
      byDomain: vi.fn().mockResolvedValue(null),
      addAlternateEmail: vi.fn().mockResolvedValue(undefined),
      updateVetCount: vi.fn().mockResolvedValue(undefined),
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
      add: vi.fn().mockResolvedValue({ id: "m1", createdAt: new Date() }),
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
      classify: vi.fn().mockResolvedValue({
        cls: opts.cls,
        confidence: opts.confidence ?? 0.9,
        vetCountGuess: opts.vetCountGuess,
        proposedTime: opts.proposedTime,
      }),
      writeDraft: vi.fn().mockResolvedValue({ subject: "Re", body: opts.aiBody ?? "yanıt" }),
    },
    notify: {
      hot: vi.fn().mockResolvedValue(undefined),
      failure: vi.fn().mockResolvedValue(undefined),
      demoTimeApproval: vi.fn().mockResolvedValue({ chatId: "12345", messageId: 7 }),
      coldDraftApproval: vi.fn().mockResolvedValue({ chatId: "12345", messageId: 8 }),
      uncertainReplyApproval: vi.fn().mockResolvedValue({ chatId: "12345", messageId: 9 }),
    },
    pendingActions: {
      create: vi.fn().mockResolvedValue({
        pending: { id: "p-1" },
        tokenPrefix: "p-1aaaaa",
      }),
      resolve: vi.fn().mockResolvedValue(true),
      updatePayload: vi.fn().mockResolvedValue(undefined),
      expireDue: vi.fn().mockResolvedValue(0),
      tokenPrefix: (id: string) => id.slice(0, 8),
    },
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

  it("AI vetCountGuess gelirse lead.vetSayisi güncellenir + segment recalculate edilir", async () => {
    // Lead solo segmentinde başlasın; AI 4 vet bildirsin → segment mid'e geçmeli.
    const deps = makeDeps({ cls: "ilgili", segment: "solo", vetCountGuess: 4 });
    await run(deps);
    expect(deps.leads.updateVetCount).toHaveBeenCalledWith("1", 4, "mid", expect.any(Number));
    expect(deps.events.log).toHaveBeenCalledWith(
      "lead_segment_updated",
      "1",
      expect.objectContaining({ from: "solo", to: "mid", vetSayisi: 4 }),
    );
  });

  it("AI vetCountGuess mevcut vetSayisi ile aynıysa update YAPILMAZ", async () => {
    const deps = makeDeps({ cls: "ilgili", segment: "mid", vetCountGuess: 4 });
    // makeLead("mid") vetSayisi=4 dönüyor.
    await run(deps);
    expect(deps.leads.updateVetCount).not.toHaveBeenCalled();
  });

  it("reply taslağı createDraft'a msg.headerMessageId geçer (In-Reply-To için)", async () => {
    const deps = makeDeps({ cls: "demo", segment: "mid" });
    await run(deps);
    expect(deps.mail.createDraft).toHaveBeenCalledWith(
      "t1",
      "a@b.com",
      "Re: Konu",
      expect.any(String),
      "<msg-1@gmail.com>",
    );
  });

  it("yeni lead + plan.notify aynı mesaj için TEK bildirim atılır (dedup)", async () => {
    // lead: null → upsertByEmail ile yeni lead yaratılır; cls=fiyat+unknown → solo_fiyat plan, notify=true.
    // İki ayrı notify.hot çağrısı OLMAMALI.
    const deps = makeDeps({ cls: "fiyat", lead: null });
    await run(deps);
    expect(deps.notify.hot).toHaveBeenCalledTimes(1);
    const call = (deps.notify.hot as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toMatch(/🆕 Web inbound · /);
  });

  it("notify label: mid + fiyat → 'Premium yanıt (mid)'", async () => {
    const deps = makeDeps({ cls: "fiyat", segment: "mid" });
    await run(deps);
    const labels = (deps.notify.hot as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(labels.some((l: string) => l.includes("Premium yanıt (mid)"))).toBe(true);
  });

  it("notify label: demo → '🔥 DEMO İSTEĞİ'", async () => {
    const deps = makeDeps({ cls: "demo", segment: "mid" });
    await run(deps);
    const labels = (deps.notify.hot as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(labels.some((l: string) => l.includes("DEMO İSTEĞİ"))).toBe(true);
  });

  it("msgs.add null dönerse (Pub/Sub duplicate) bildirim/draft atılmaz", async () => {
    const deps = makeDeps({ cls: "demo", segment: "mid" });
    deps.msgs.add = vi.fn().mockResolvedValue(null);
    await run(deps);
    expect(deps.notify.hot).not.toHaveBeenCalled();
    expect(deps.mail.createDraft).not.toHaveBeenCalled();
  });

  it("durum=demo_istedi + ilgili cevap → draft YOK, sadece bildirim", async () => {
    // Müşteri demo'yu onayladı, sonra "teşekkür ettim" yazdı. Bot intro tekrarlamamalı.
    const lead = makeLead("mid");
    lead.durum = "demo_istedi";
    const deps = makeDeps({ cls: "ilgili", segment: "mid", lead });
    await run(deps);
    expect(deps.mail.createDraft).not.toHaveBeenCalled();
    expect(deps.notify.hot).toHaveBeenCalled();
    const labels = (deps.notify.hot as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(labels.some((l: string) => l.includes("Demo sonrası mesaj"))).toBe(true);
  });

  it("durum=demo_istedi + ilgili → durum gerilemez (newDurum yok)", async () => {
    const lead = makeLead("mid");
    lead.durum = "demo_istedi";
    const deps = makeDeps({ cls: "ilgili", segment: "mid", lead });
    await run(deps);
    expect(deps.leads.updateDurum).not.toHaveBeenCalled();
  });

  it("durum=demo_istedi + cikis → opt-out hâlâ işler (common path)", async () => {
    // Demo onaylandıktan sonra bile çıkış talebi gelirse normal cikis_reply tetiklenir.
    const lead = makeLead("mid");
    lead.durum = "demo_istedi";
    const deps = makeDeps({
      cls: "cikis",
      segment: "mid",
      lead,
      aiBody: "Sizi listeden çıkardım.",
    });
    await run(deps);
    expect(deps.supp.add).toHaveBeenCalled();
    expect(deps.leads.updateDurum).toHaveBeenCalledWith("1", "cikti");
    expect(deps.mail.createDraft).toHaveBeenCalled();
  });

  // ADR-0006 §2.4 — substring guardrail
  it("proposedTime body'de literal substring → korunur, log YOK", async () => {
    const lead = makeLead("mid");
    lead.durum = "demo_istedi";
    const deps = makeDeps({
      cls: "ilgili",
      segment: "mid",
      lead,
      proposedTime: { raw: "merhaba" },
    });
    await run(deps);
    expect(deps.events.log).not.toHaveBeenCalledWith(
      "classify_propose_time_hallucination",
      expect.anything(),
      expect.anything(),
    );
  });

  it("proposedTime body'de YOK (AI uydurma) → drop + halüsinasyon event log", async () => {
    const lead = makeLead("mid");
    lead.durum = "demo_istedi";
    const deps = makeDeps({
      cls: "ilgili",
      segment: "mid",
      lead,
      proposedTime: { raw: "Salı 14:00" },
    });
    // msg.body = "merhaba", "Salı 14:00" yok → drop
    await run(deps);
    expect(deps.events.log).toHaveBeenCalledWith(
      "classify_propose_time_hallucination",
      null,
      expect.objectContaining({ raw: "Salı 14:00", cls: "ilgili" }),
    );
  });

  // ADR-0006 §2.1 akış #3 — demo time onayı
  it("durum=demo_istedi + proposedTime VAR → pending_action + demoTimeApproval (2 buton)", async () => {
    const lead = makeLead("mid");
    lead.durum = "demo_istedi";
    const deps = makeDeps({
      cls: "ilgili",
      segment: "mid",
      lead,
      proposedTime: { raw: "merhaba" },
    });
    // msg.body = "merhaba" → proposedTime substring matches → korunur
    await run(deps);
    expect(deps.pendingActions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "confirm_demo_time",
        leadId: "1",
        gmailThreadId: "t1",
        payload: expect.objectContaining({
          proposedTimeRaw: "merhaba",
          fromEmail: "a@b.com",
          headerMessageId: "<msg-1@gmail.com>",
        }),
      }),
    );
    expect(deps.notify.demoTimeApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        lead,
        fromEmail: "a@b.com",
        rawTime: "merhaba",
        threadId: "t1",
        tokenPrefix: expect.any(String),
      }),
    );
    // Pending payload'a telegram lokasyonu yazılır (T8 edit için)
    expect(deps.pendingActions.updatePayload).toHaveBeenCalledWith(
      "p-1",
      expect.objectContaining({
        telegram: { chatId: "12345", messageId: 7 },
      }),
    );
    // Hot notify atlanır (duplicate engeli) — sadece demo button mesajı gitsin.
    expect(deps.notify.hot).not.toHaveBeenCalled();
    // Bot taslak yazmaz (sendDraft hala false).
    expect(deps.mail.createDraft).not.toHaveBeenCalled();
    expect(deps.events.log).toHaveBeenCalledWith(
      "demo_time_pending",
      "1",
      expect.objectContaining({ raw: "merhaba" }),
    );
  });

  it("durum=demo_istedi + proposedTime YOK → eski info notify (status quo)", async () => {
    const lead = makeLead("mid");
    lead.durum = "demo_istedi";
    const deps = makeDeps({ cls: "ilgili", segment: "mid", lead });
    await run(deps);
    expect(deps.pendingActions.create).not.toHaveBeenCalled();
    expect(deps.notify.demoTimeApproval).not.toHaveBeenCalled();
    expect(deps.notify.hot).toHaveBeenCalled();
    const labels = (deps.notify.hot as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0],
    );
    expect(labels.some((l: string) => l.includes("Demo sonrası mesaj"))).toBe(true);
  });

  it("demoTimeApproval Telegram fail → pending cancelled, fall-back hot notify", async () => {
    const lead = makeLead("mid");
    lead.durum = "demo_istedi";
    const deps = makeDeps({
      cls: "ilgili",
      segment: "mid",
      lead,
      proposedTime: { raw: "merhaba" },
    });
    deps.notify.demoTimeApproval = vi.fn().mockResolvedValue(null);
    await run(deps);
    expect(deps.pendingActions.resolve).toHaveBeenCalledWith("p-1", "cancelled");
    expect(deps.notify.hot).toHaveBeenCalled();
  });
});
