import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const expireDue = vi.fn();
const logEvent = vi.fn();

vi.mock("@/lib/wiring", () => ({
  pendingActionService: { expireDue },
  eventRepo: { log: logEvent },
}));

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/cron/expire-pending", {
    method: "POST",
    headers,
  });
}

describe("POST /api/cron/expire-pending", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret";
    expireDue.mockReset();
    logEvent.mockReset();
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("auth header yanlış → 401", async () => {
    const { POST } = await import("@/app/api/cron/expire-pending/route");
    const res = await POST(req({ authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
    expect(expireDue).not.toHaveBeenCalled();
  });

  it("auth doğru + 0 expired → ok=true, expired=0, log YOK", async () => {
    expireDue.mockResolvedValue(0);
    const { POST } = await import("@/app/api/cron/expire-pending/route");
    const res = await POST(req({ authorization: "Bearer cron-secret" }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; expired: number };
    expect(json).toEqual({ ok: true, expired: 0 });
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("auth doğru + N expired → log + counts", async () => {
    expireDue.mockResolvedValue(4);
    const { POST } = await import("@/app/api/cron/expire-pending/route");
    const res = await POST(req({ authorization: "Bearer cron-secret" }));
    const json = (await res.json()) as { expired: number };
    expect(json.expired).toBe(4);
    expect(logEvent).toHaveBeenCalledWith(
      "pending_action_expired",
      null,
      expect.objectContaining({ count: 4 }),
    );
  });

  it("service throw → 500 + ok=false", async () => {
    expireDue.mockRejectedValue(new Error("db down"));
    const { POST } = await import("@/app/api/cron/expire-pending/route");
    const res = await POST(req({ authorization: "Bearer cron-secret" }));
    expect(res.status).toBe(500);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/db down/);
  });
});
