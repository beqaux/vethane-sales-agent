import { describe, it, expect, vi } from "vitest";
import {
  createTelegramCallbackService,
  type TelegramCallbackDeps,
  type TelegramCallbackQuery,
} from "@/lib/services/telegram-callback";
import type { PendingAction } from "@/lib/domain/types";

function pending(over: Partial<PendingAction> = {}): PendingAction {
  return {
    id: "abcdef12-3456-7890-abcd-ef1234567890",
    kind: "send_draft",
    leadId: "lead-1",
    gmailDraftId: "draft-1",
    gmailThreadId: "thread-1",
    payload: {
      telegram: { chatId: "12345", messageId: 99 },
    },
    status: "pending",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    createdAt: new Date(),
    resolvedAt: null,
    ...over,
  };
}

function cb(over: Partial<TelegramCallbackQuery> = {}): TelegramCallbackQuery {
  return {
    id: "cb-1",
    data: "act:abcdef12:open",
    from: { id: 12345 },
    message: { chat: { id: 12345 }, message_id: 99 },
    ...over,
  };
}

function makeDeps() {
  const notify = makeNotifyMock();
  const pendingActions = makePendingMock();
  const leads = {
    byId: vi.fn(),
    dueForSend: vi.fn(),
    byEmail: vi.fn(),
    byThread: vi.fn(),
    upsertByEmail: vi.fn(),
    updateDurum: vi.fn(),
    setThread: vi.fn(),
    upsertCandidate: vi.fn(),
    listByDurum: vi.fn(),
    setEmail: vi.fn(),
    byDomain: vi.fn(),
    addAlternateEmail: vi.fn(),
    updateVetCount: vi.fn(),
  };
  const supp = { has: vi.fn().mockResolvedValue(false), add: vi.fn() };
  const msgs = {
    add: vi.fn().mockResolvedValue({ id: "m1" }),
    existsInbound: vi.fn(),
  };
  const mail = {
    createDraft: vi.fn().mockResolvedValue({ id: "draft-x", threadId: "thr-x" }),
    send: vi.fn().mockResolvedValue("sent-msg-id"),
    listRecentInbound: vi.fn(),
    addLabel: vi.fn(),
    watch: vi.fn(),
  };
  const events = { log: vi.fn().mockResolvedValue(undefined) };
  return {
    pendingActions,
    leads,
    supp,
    msgs,
    events,
    mail,
    notify,
  };
}

function buildSvc(d: ReturnType<typeof makeDeps>) {
  return createTelegramCallbackService(d as unknown as TelegramCallbackDeps);
}

function makeNotifyMock() {
  return {
    notify: vi.fn().mockResolvedValue({ messageId: 1, chatId: "12345" }),
    edit: vi.fn().mockResolvedValue(undefined),
    answerCallback: vi.fn().mockResolvedValue(undefined),
  };
}

function makePendingMock() {
  let stored: PendingAction | null = null;
  return {
    byPrefix: vi.fn(async () => stored),
    byId: vi.fn(async () => stored),
    create: vi.fn(),
    resolve: vi.fn(async () => true),
    updatePayload: vi.fn(),
    expireDue: vi.fn(),
    _set(p: PendingAction | null) {
      stored = p;
    },
  };
}

describe("telegramCallbackService.handle", () => {
  it("geçersiz callback_data → 'Geçersiz aksiyon' toast", async () => {
    const deps = makeDeps();
    const svc = buildSvc(deps);
    await svc.handle(cb({ data: "totally-bogus" }));
    expect(deps.notify.answerCallback).toHaveBeenCalledWith("cb-1", {
      text: "Geçersiz aksiyon",
    });
  });

  it("prefix length != 8 → 'Geçersiz prefix' toast", async () => {
    const deps = makeDeps();
    const svc = buildSvc(deps);
    await svc.handle(cb({ data: "act:short:open" }));
    expect(deps.notify.answerCallback).toHaveBeenCalledWith("cb-1", {
      text: "Geçersiz prefix",
    });
  });

  it("pending bulunamadı → 'Bu işlem bulunamadı'", async () => {
    const deps = makeDeps();
    deps.pendingActions._set(null);
    const svc = buildSvc(deps);
    await svc.handle(cb());
    expect(deps.notify.answerCallback).toHaveBeenCalledWith("cb-1", {
      text: "Bu işlem bulunamadı",
    });
  });

  it("status=resolved → 'Zaten yapıldı (HH:MM)' (E3)", async () => {
    const deps = makeDeps();
    const resolvedAt = new Date(2026, 4, 27, 14, 30);
    deps.pendingActions._set(pending({ status: "resolved", resolvedAt }));
    const svc = buildSvc(deps);
    await svc.handle(cb());
    const call = deps.notify.answerCallback.mock.calls[0];
    expect(call[1].text).toMatch(/Zaten yapıldı/);
  });

  it("status=cancelled → 'Zaten iptal edilmiş'", async () => {
    const deps = makeDeps();
    deps.pendingActions._set(
      pending({ status: "cancelled", resolvedAt: new Date() }),
    );
    const svc = buildSvc(deps);
    await svc.handle(cb());
    expect(deps.notify.answerCallback).toHaveBeenCalledWith("cb-1", {
      text: "Zaten iptal edilmiş",
    });
  });

  it("status=expired → '⏱ 7 günden eski'", async () => {
    const deps = makeDeps();
    deps.pendingActions._set(
      pending({ status: "expired", resolvedAt: new Date() }),
    );
    const svc = buildSvc(deps);
    await svc.handle(cb());
    expect(deps.notify.answerCallback).toHaveBeenCalledWith("cb-1", {
      text: "⏱ 7 günden eski",
    });
  });

  it("expiresAt < now → lazy-expire + toast (E4)", async () => {
    const deps = makeDeps();
    deps.pendingActions._set(
      pending({ expiresAt: new Date(Date.now() - 1000) }),
    );
    const svc = buildSvc(deps);
    await svc.handle(cb());
    expect(deps.pendingActions.resolve).toHaveBeenCalledWith(
      expect.any(String),
      "expired",
    );
    expect(deps.notify.answerCallback).toHaveBeenCalledWith("cb-1", {
      text: "⏱ 7 günden eski",
    });
  });

  it("open verb → pending resolve, edit + ack", async () => {
    const deps = makeDeps();
    deps.pendingActions._set(pending());
    const svc = buildSvc(deps);
    await svc.handle(cb({ data: "act:abcdef12:open" }));
    expect(deps.pendingActions.resolve).toHaveBeenCalledWith(
      expect.any(String),
      "resolved",
    );
    expect(deps.notify.edit).toHaveBeenCalledWith(
      "12345",
      99,
      expect.stringContaining("Gmail'e"),
    );
    expect(deps.notify.answerCallback).toHaveBeenCalledWith("cb-1", {
      text: "Gmail'e açıldı",
    });
    expect(deps.events.log).toHaveBeenCalledWith(
      "pending_opened_in_gmail",
      "lead-1",
      expect.any(Object),
    );
  });

  it("open verb + resolve race kaybeder → 'Zaten yapıldı' toast", async () => {
    const deps = makeDeps();
    deps.pendingActions._set(pending());
    deps.pendingActions.resolve = vi.fn(async () => false);
    const svc = buildSvc(deps);
    await svc.handle(cb({ data: "act:abcdef12:open" }));
    expect(deps.notify.edit).not.toHaveBeenCalled();
    expect(deps.notify.answerCallback).toHaveBeenCalledWith("cb-1", {
      text: "Zaten yapıldı",
    });
  });

  it("bilinmeyen verb → 'henüz hazır değil' toast (T10 placeholder)", async () => {
    const deps = makeDeps();
    deps.pendingActions._set(pending());
    const svc = buildSvc(deps);
    await svc.handle(cb({ data: "act:abcdef12:weirdverb" }));
    expect(deps.notify.answerCallback).toHaveBeenCalledWith("cb-1", {
      text: "Bu aksiyon henüz hazır değil",
    });
  });
});

// ADR-0006 §2.1 akış #3 — T8 confirm_demo_time callback
describe("telegramCallbackService.handle — confirm_demo_time", () => {
  function leadFixture(durum: "sekansta" | "demo_istedi" | "cikti" | "kaybedildi" = "demo_istedi") {
    return {
      id: "lead-1",
      kurumAdi: "Pati Polikliniği",
      sehir: "İzmir",
      tur: "poliklinik" as const,
      vetSayisi: 4,
      segment: "mid" as const,
      tier: 1 as const,
      email: "klinik@example.com",
      emailConfidence: null,
      website: null,
      placeId: null,
      phone: null,
      instagram: null,
      kararVerici: "Ahmet Yılmaz",
      kaynak: null,
      durum,
      gmailThreadId: "thr-1",
      alternateEmails: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  function demoPending() {
    return pending({
      kind: "confirm_demo_time",
      payload: {
        proposedTimeRaw: "Salı 14:00",
        fromEmail: "klinik@example.com",
        subject: "Re: Demo",
        headerMessageId: "<orig@gmail.com>",
        telegram: { chatId: "12345", messageId: 99 },
      },
    });
  }

  it("happy path: CAS → guards → createDraft + send → edit ✅ + ack + event", async () => {
    const deps = makeDeps();
    deps.pendingActions._set(demoPending());
    deps.leads.byId.mockResolvedValue(leadFixture());
    const svc = buildSvc(deps);
    await svc.handle(cb({ data: "act:abcdef12:confirm" }));

    expect(deps.pendingActions.resolve).toHaveBeenCalledWith(
      expect.any(String),
      "resolved",
    );
    expect(deps.mail.createDraft).toHaveBeenCalledWith(
      expect.any(String),
      "klinik@example.com",
      "Re: Demo",
      expect.stringContaining("Salı 14:00"),
      "<orig@gmail.com>",
    );
    expect(deps.mail.send).toHaveBeenCalledWith("draft-x");
    expect(deps.msgs.add).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: "out",
        status: "sent",
      }),
    );
    expect(deps.notify.edit).toHaveBeenCalledWith(
      "12345",
      99,
      expect.stringMatching(/^✅ Onaylandı/),
    );
    expect(deps.notify.answerCallback).toHaveBeenCalledWith("cb-1", {
      text: "Gönderildi",
    });
    expect(deps.events.log).toHaveBeenCalledWith(
      "demo_time_confirmed",
      "lead-1",
      expect.objectContaining({ raw: "Salı 14:00", draftId: "draft-x" }),
    );
  });

  it("template müşterinin adı + literal saat alıntısını içerir", async () => {
    const deps = makeDeps();
    deps.pendingActions._set(demoPending());
    deps.leads.byId.mockResolvedValue(leadFixture());
    const svc = buildSvc(deps);
    await svc.handle(cb({ data: "act:abcdef12:confirm" }));
    const body = (deps.mail.createDraft.mock.calls[0] as unknown[])[3] as string;
    expect(body).toMatch(/Merhaba Ahmet,/);
    expect(body).toContain('"Salı 14:00" bende de uygun');
    expect(body).toContain("Görüşme linkini toplantıdan ~15 dk önce ileteceğim");
  });

  it("ikinci tap (race kazanan başka) → 'Zaten yapıldı' + iş yapılmaz", async () => {
    const deps = makeDeps();
    deps.pendingActions._set(demoPending());
    deps.pendingActions.resolve = vi.fn().mockResolvedValue(false);
    const svc = buildSvc(deps);
    await svc.handle(cb({ data: "act:abcdef12:confirm" }));
    expect(deps.mail.createDraft).not.toHaveBeenCalled();
    expect(deps.notify.answerCallback).toHaveBeenCalledWith("cb-1", {
      text: "Zaten yapıldı",
    });
  });

  it("E5: durum=kaybedildi → refuse + edit + log + ack", async () => {
    const deps = makeDeps();
    deps.pendingActions._set(demoPending());
    deps.leads.byId.mockResolvedValue(leadFixture("kaybedildi"));
    const svc = buildSvc(deps);
    await svc.handle(cb({ data: "act:abcdef12:confirm" }));
    expect(deps.mail.createDraft).not.toHaveBeenCalled();
    expect(deps.notify.edit).toHaveBeenCalledWith(
      "12345",
      99,
      expect.stringMatching(/Lead durumu değişmiş/),
    );
    expect(deps.events.log).toHaveBeenCalledWith(
      "demo_time_skipped_durum",
      "lead-1",
      expect.objectContaining({ durum: "kaybedildi" }),
    );
  });

  it("E5: durum=cikti → refuse", async () => {
    const deps = makeDeps();
    deps.pendingActions._set(demoPending());
    deps.leads.byId.mockResolvedValue(leadFixture("cikti"));
    const svc = buildSvc(deps);
    await svc.handle(cb({ data: "act:abcdef12:confirm" }));
    expect(deps.mail.createDraft).not.toHaveBeenCalled();
  });

  it("E6: suppression → refuse + edit suppression mesajı", async () => {
    const deps = makeDeps();
    deps.pendingActions._set(demoPending());
    deps.leads.byId.mockResolvedValue(leadFixture());
    deps.supp.has = vi.fn().mockResolvedValue(true);
    const svc = buildSvc(deps);
    await svc.handle(cb({ data: "act:abcdef12:confirm" }));
    expect(deps.mail.createDraft).not.toHaveBeenCalled();
    expect(deps.notify.edit).toHaveBeenCalledWith(
      "12345",
      99,
      expect.stringMatching(/suppression/i),
    );
  });

  it("E8: mail.send fail → edit ❌ + alert ack + event", async () => {
    const deps = makeDeps();
    deps.pendingActions._set(demoPending());
    deps.leads.byId.mockResolvedValue(leadFixture());
    deps.mail.send = vi.fn().mockRejectedValue(new Error("network 503"));
    const svc = buildSvc(deps);
    await svc.handle(cb({ data: "act:abcdef12:confirm" }));
    expect(deps.notify.edit).toHaveBeenCalledWith(
      "12345",
      99,
      expect.stringMatching(/Gönderim başarısız/),
    );
    expect(deps.notify.answerCallback).toHaveBeenCalledWith(
      "cb-1",
      expect.objectContaining({ alert: true }),
    );
    expect(deps.events.log).toHaveBeenCalledWith(
      "demo_time_send_failed",
      "lead-1",
      expect.objectContaining({ error: "network 503" }),
    );
  });

  it("payload eksik (proposedTimeRaw yok) → refuse + log", async () => {
    const deps = makeDeps();
    const p = demoPending();
    p.payload = { fromEmail: "x@y.z" }; // proposedTimeRaw yok
    deps.pendingActions._set(p);
    deps.leads.byId.mockResolvedValue(leadFixture());
    const svc = buildSvc(deps);
    await svc.handle(cb({ data: "act:abcdef12:confirm" }));
    expect(deps.mail.createDraft).not.toHaveBeenCalled();
    expect(deps.events.log).toHaveBeenCalledWith(
      "demo_time_payload_missing",
      "lead-1",
      expect.any(Object),
    );
  });

  it("reply subject: 'Re: ' yoksa eklenir", async () => {
    const deps = makeDeps();
    const p = demoPending();
    p.payload = {
      ...(p.payload as Record<string, unknown>),
      subject: "Demo görüşme",
    };
    deps.pendingActions._set(p);
    deps.leads.byId.mockResolvedValue(leadFixture());
    const svc = buildSvc(deps);
    await svc.handle(cb({ data: "act:abcdef12:confirm" }));
    expect(deps.mail.createDraft).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "Re: Demo görüşme",
      expect.any(String),
      expect.anything(),
    );
  });
});
