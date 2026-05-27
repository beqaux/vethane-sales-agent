import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// grammy'nin Api sınıfı network çağrıları yapar; testte mock'luyoruz.
const sendMessage = vi.fn();
const editMessageText = vi.fn();
const answerCallbackQuery = vi.fn();

vi.mock("grammy", () => ({
  Api: class {
    sendMessage = sendMessage;
    editMessageText = editMessageText;
    answerCallbackQuery = answerCallbackQuery;
  },
}));

describe("telegramAdapter", () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "12345";
    sendMessage.mockReset();
    editMessageText.mockReset();
    answerCallbackQuery.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  it("notify(text) — opts'suz eski davranış, messageId + chatId döner", async () => {
    sendMessage.mockResolvedValue({ message_id: 42 });
    const { telegramAdapter } = await import("@/lib/adapters/telegram");
    const res = await telegramAdapter.notify("merhaba");
    expect(res).toEqual({ messageId: 42, chatId: "12345" });
    expect(sendMessage).toHaveBeenCalledWith(
      "12345",
      "merhaba",
      expect.objectContaining({ parse_mode: "HTML" }),
    );
    expect(sendMessage.mock.calls[0][2]).not.toHaveProperty("reply_markup");
  });

  it("notify(text, { buttons }) — inline keyboard ile mesaj atar", async () => {
    sendMessage.mockResolvedValue({ message_id: 7 });
    const { telegramAdapter } = await import("@/lib/adapters/telegram");
    const buttons = [
      [
        { text: "✅ Onayla", callback_data: "act:abcdef12:confirm" },
        { text: "✏️ Gmail", url: "https://mail.google.com/" },
      ],
    ];
    const res = await telegramAdapter.notify("body", { buttons });
    expect(res.messageId).toBe(7);
    expect(sendMessage.mock.calls[0][2].reply_markup).toEqual({
      inline_keyboard: buttons,
    });
  });

  it("edit() — chatId+messageId üzerinden metin + buton günceller", async () => {
    editMessageText.mockResolvedValue({});
    const { telegramAdapter } = await import("@/lib/adapters/telegram");
    await telegramAdapter.edit("12345", 99, "yeni metin", { buttons: [] });
    expect(editMessageText).toHaveBeenCalledWith(
      "12345",
      99,
      "yeni metin",
      expect.objectContaining({ parse_mode: "HTML" }),
    );
    // Boş button array → reply_markup gönderme (button kaldırma için ayrı API var).
    expect(editMessageText.mock.calls[0][3]).not.toHaveProperty("reply_markup");
  });

  it("answerCallback() — text + alert iletir", async () => {
    answerCallbackQuery.mockResolvedValue(true);
    const { telegramAdapter } = await import("@/lib/adapters/telegram");
    await telegramAdapter.answerCallback("cb-1", { text: "Gönderildi", alert: true });
    expect(answerCallbackQuery).toHaveBeenCalledWith(
      "cb-1",
      expect.objectContaining({ text: "Gönderildi", show_alert: true }),
    );
  });

  it("answerCallback() — opts yoksa ack-only", async () => {
    answerCallbackQuery.mockResolvedValue(true);
    const { telegramAdapter } = await import("@/lib/adapters/telegram");
    await telegramAdapter.answerCallback("cb-2");
    expect(answerCallbackQuery).toHaveBeenCalledWith("cb-2", expect.any(Object));
    const opts = answerCallbackQuery.mock.calls[0][1];
    expect(opts).not.toHaveProperty("text");
    expect(opts).not.toHaveProperty("show_alert");
  });
});
