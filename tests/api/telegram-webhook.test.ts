import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// wiring.ts'in başına bağlanan repolarla (DB lazy proxy) çakışmamak için
// service + adapter'ları mock'luyoruz.
const handleCb = vi.fn();
const logEvent = vi.fn();
const answerCb = vi.fn();

vi.mock("@/lib/wiring", () => ({
  telegramCallbackService: { handle: handleCb },
  eventRepo: { log: logEvent },
  telegramAdapter: { answerCallback: answerCb },
}));

function jsonReq(headers: Record<string, string>, body: unknown): Request {
  return new Request("https://example.test/api/webhooks/telegram", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/webhooks/telegram", () => {
  beforeEach(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = "secret-123";
    process.env.TELEGRAM_CHAT_ID = "12345";
    handleCb.mockReset();
    logEvent.mockReset();
    answerCb.mockReset();
  });

  afterEach(() => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  it("yanlış secret → 401, dispatcher çağrılmaz", async () => {
    const { POST } = await import("@/app/api/webhooks/telegram/route");
    const res = await POST(
      jsonReq({ "x-telegram-bot-api-secret-token": "wrong" }, {}),
    );
    expect(res.status).toBe(401);
    expect(handleCb).not.toHaveBeenCalled();
  });

  it("secret yok → 401", async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const { POST } = await import("@/app/api/webhooks/telegram/route");
    const res = await POST(
      jsonReq({ "x-telegram-bot-api-secret-token": "anything" }, {}),
    );
    expect(res.status).toBe(401);
  });

  it("callback_query yok (message update) → 200 silent", async () => {
    const { POST } = await import("@/app/api/webhooks/telegram/route");
    const res = await POST(
      jsonReq(
        { "x-telegram-bot-api-secret-token": "secret-123" },
        { update_id: 1, message: { text: "hello" } },
      ),
    );
    expect(res.status).toBe(200);
    expect(handleCb).not.toHaveBeenCalled();
  });

  it("yetkisiz chat_id → 200 silent + event log", async () => {
    const { POST } = await import("@/app/api/webhooks/telegram/route");
    const res = await POST(
      jsonReq(
        { "x-telegram-bot-api-secret-token": "secret-123" },
        {
          callback_query: {
            id: "cb-x",
            data: "act:abcdef12:open",
            from: { id: 99999 },
          },
        },
      ),
    );
    expect(res.status).toBe(200);
    expect(handleCb).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      "telegram_unauthorized_callback",
      null,
      expect.objectContaining({ fromId: "99999" }),
    );
  });

  it("yetkili chat_id + valid callback → dispatcher çağrılır", async () => {
    handleCb.mockResolvedValue(undefined);
    const { POST } = await import("@/app/api/webhooks/telegram/route");
    const cb = {
      id: "cb-y",
      data: "act:abcdef12:confirm",
      from: { id: 12345 },
      message: { chat: { id: 12345 }, message_id: 7 },
    };
    const res = await POST(
      jsonReq(
        { "x-telegram-bot-api-secret-token": "secret-123" },
        { callback_query: cb },
      ),
    );
    expect(res.status).toBe(200);
    expect(handleCb).toHaveBeenCalledWith(cb);
  });

  it("dispatcher throw ederse 200 dön + error log + ack fallback", async () => {
    handleCb.mockRejectedValue(new Error("boom"));
    answerCb.mockResolvedValue(undefined);
    const { POST } = await import("@/app/api/webhooks/telegram/route");
    const res = await POST(
      jsonReq(
        { "x-telegram-bot-api-secret-token": "secret-123" },
        {
          callback_query: {
            id: "cb-z",
            data: "act:abcdef12:open",
            from: { id: 12345 },
          },
        },
      ),
    );
    expect(res.status).toBe(200);
    expect(logEvent).toHaveBeenCalledWith(
      "telegram_callback_error",
      null,
      expect.objectContaining({ error: "boom" }),
    );
    expect(answerCb).toHaveBeenCalledWith(
      "cb-z",
      expect.objectContaining({ text: "İç hata — log'a düştü", alert: true }),
    );
  });

  it("invalid JSON body → 200 silent", async () => {
    const { POST } = await import("@/app/api/webhooks/telegram/route");
    const res = await POST(
      jsonReq({ "x-telegram-bot-api-secret-token": "secret-123" }, "{not-json"),
    );
    expect(res.status).toBe(200);
  });
});
