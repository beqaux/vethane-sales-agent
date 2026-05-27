import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createNotifyService,
  formatFailure,
} from "@/lib/services/notify";
import type { Lead, InboundMessage } from "@/lib/domain/types";

function makeLead(over: Partial<Lead> = {}): Lead {
  return {
    id: "L1",
    kurumAdi: "Test Klinik",
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
    durum: "sekansta",
    gmailThreadId: "thr-1",
    alternateEmails: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function makePort() {
  return {
    notify: vi.fn().mockResolvedValue({ messageId: 1, chatId: "c1" }),
    edit: vi.fn().mockResolvedValue(undefined),
    answerCallback: vi.fn().mockResolvedValue(undefined),
  };
}

describe("notify.formatFailure", () => {
  it("guardrail kind → 🚫 Block prefix + action + sebep", () => {
    const lead = makeLead();
    const out = formatFailure({
      kind: "guardrail",
      lead,
      action: "mid_cold",
      reason: "fiyat sızdı",
    });
    expect(out).toMatch(/^🚫 Block/);
    expect(out).toContain("Klinik: Test Klinik · İzmir");
    expect(out).toContain("Action: mid_cold");
    expect(out).toContain("Sebep: fiyat sızdı");
  });

  it("error kind → ⚠️ Error prefix", () => {
    const out = formatFailure({ kind: "error", reason: "Gmail 503" });
    expect(out).toMatch(/^⚠️ Error/);
    expect(out).toContain("Sebep: Gmail 503");
  });

  it("lead yoksa Klinik satırı atlanır", () => {
    const out = formatFailure({ kind: "error", reason: "boom" });
    expect(out).not.toMatch(/Klinik:/);
  });

  it("action yoksa Action satırı atlanır", () => {
    const out = formatFailure({
      kind: "guardrail",
      lead: makeLead(),
      reason: "x",
    });
    expect(out).not.toMatch(/Action:/);
  });

  it("uzun reason 400 char truncate", () => {
    const long = "a".repeat(600);
    const out = formatFailure({ kind: "error", reason: long });
    expect(out).toMatch(/…$/);
    expect(out.length).toBeLessThan(500);
  });
});

describe("notifyService", () => {
  let port: ReturnType<typeof makePort>;
  let svc: ReturnType<typeof createNotifyService>;

  beforeEach(() => {
    port = makePort();
    svc = createNotifyService(port);
  });

  it("failure(): port.notify çağrılır + Gmail buton varsa thread linkten", async () => {
    const lead = makeLead({ gmailThreadId: "thr-x" });
    await svc.failure({ kind: "guardrail", lead, action: "mid_cold", reason: "test" });
    expect(port.notify).toHaveBeenCalledTimes(1);
    const [, opts] = port.notify.mock.calls[0] as [
      string,
      { buttons?: unknown } | undefined,
    ];
    expect(opts?.buttons).toEqual([
      [{ text: "✏️ Gmail", url: "https://mail.google.com/mail/u/0/#all/thr-x" }],
    ]);
  });

  it("failure(): lead+thread yoksa buton gönderilmez", async () => {
    await svc.failure({ kind: "error", reason: "boom" });
    expect(port.notify).toHaveBeenCalledTimes(1);
    const opts = port.notify.mock.calls[0][1];
    expect(opts).toBeUndefined();
  });

  it("failure(): port atarsa servis sessizce yutar (best-effort)", async () => {
    port.notify.mockRejectedValue(new Error("network"));
    await expect(
      svc.failure({ kind: "error", reason: "x" }),
    ).resolves.toBeUndefined();
  });

  it("hot(): mevcut format korunmuş — header + segment + Gmail link", async () => {
    const lead = makeLead();
    const msg: InboundMessage = {
      gmailMessageId: "g1",
      threadId: "thr-1",
      fromEmail: "a@b.com",
      subject: "Konu",
      body: "merhaba",
      receivedAt: new Date(),
      headerMessageId: null,
    };
    await svc.hot("🆕 Test", lead, msg);
    expect(port.notify).toHaveBeenCalled();
    const [text] = port.notify.mock.calls[0] as [string];
    expect(text).toContain("🆕 Test");
    expect(text).toContain("Klinik: Test Klinik");
    expect(text).toContain("Gmail: https://mail.google.com/");
  });
});
