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

function makeDeps(): TelegramCallbackDeps & {
  notify: ReturnType<typeof makeNotifyMock>;
  pendingActions: ReturnType<typeof makePendingMock>;
  events: { log: ReturnType<typeof vi.fn> };
} {
  const notify = makeNotifyMock();
  const pendingActions = makePendingMock();
  return {
    pendingActions,
    leads: {} as TelegramCallbackDeps["leads"],
    supp: {} as TelegramCallbackDeps["supp"],
    msgs: {} as TelegramCallbackDeps["msgs"],
    events: { log: vi.fn().mockResolvedValue(undefined) },
    mail: {} as TelegramCallbackDeps["mail"],
    notify,
  };
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
    const svc = createTelegramCallbackService(deps);
    await svc.handle(cb({ data: "totally-bogus" }));
    expect(deps.notify.answerCallback).toHaveBeenCalledWith("cb-1", {
      text: "Geçersiz aksiyon",
    });
  });

  it("prefix length != 8 → 'Geçersiz prefix' toast", async () => {
    const deps = makeDeps();
    const svc = createTelegramCallbackService(deps);
    await svc.handle(cb({ data: "act:short:open" }));
    expect(deps.notify.answerCallback).toHaveBeenCalledWith("cb-1", {
      text: "Geçersiz prefix",
    });
  });

  it("pending bulunamadı → 'Bu işlem bulunamadı'", async () => {
    const deps = makeDeps();
    deps.pendingActions._set(null);
    const svc = createTelegramCallbackService(deps);
    await svc.handle(cb());
    expect(deps.notify.answerCallback).toHaveBeenCalledWith("cb-1", {
      text: "Bu işlem bulunamadı",
    });
  });

  it("status=resolved → 'Zaten yapıldı (HH:MM)' (E3)", async () => {
    const deps = makeDeps();
    const resolvedAt = new Date(2026, 4, 27, 14, 30);
    deps.pendingActions._set(pending({ status: "resolved", resolvedAt }));
    const svc = createTelegramCallbackService(deps);
    await svc.handle(cb());
    const call = deps.notify.answerCallback.mock.calls[0];
    expect(call[1].text).toMatch(/Zaten yapıldı/);
  });

  it("status=cancelled → 'Zaten iptal edilmiş'", async () => {
    const deps = makeDeps();
    deps.pendingActions._set(
      pending({ status: "cancelled", resolvedAt: new Date() }),
    );
    const svc = createTelegramCallbackService(deps);
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
    const svc = createTelegramCallbackService(deps);
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
    const svc = createTelegramCallbackService(deps);
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
    const svc = createTelegramCallbackService(deps);
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
    const svc = createTelegramCallbackService(deps);
    await svc.handle(cb({ data: "act:abcdef12:open" }));
    expect(deps.notify.edit).not.toHaveBeenCalled();
    expect(deps.notify.answerCallback).toHaveBeenCalledWith("cb-1", {
      text: "Zaten yapıldı",
    });
  });

  it("bilinmeyen verb → 'henüz hazır değil' toast (T8/T10 placeholder)", async () => {
    const deps = makeDeps();
    deps.pendingActions._set(pending());
    const svc = createTelegramCallbackService(deps);
    await svc.handle(cb({ data: "act:abcdef12:weirdverb" }));
    expect(deps.notify.answerCallback).toHaveBeenCalledWith("cb-1", {
      text: "Bu aksiyon henüz hazır değil",
    });
  });
});
