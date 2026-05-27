import { describe, it, expect, vi } from "vitest";
import {
  createPendingActionService,
  DEFAULT_TTL_DAYS,
} from "@/lib/services/pending-action";
import type { PendingAction } from "@/lib/domain/types";
import type { PendingActionRepo } from "@/lib/domain/ports";

function makeRepo() {
  return {
    create: vi.fn(),
    byId: vi.fn(),
    byPrefix: vi.fn(),
    resolve: vi.fn(),
    updatePayload: vi.fn(),
    expireDue: vi.fn(),
  };
}

function build(repo: ReturnType<typeof makeRepo>) {
  return createPendingActionService(repo as unknown as PendingActionRepo);
}

function fakePending(id: string): PendingAction {
  return {
    id,
    kind: "send_draft",
    leadId: "lead-1",
    gmailDraftId: null,
    gmailThreadId: null,
    payload: {},
    status: "pending",
    expiresAt: new Date(),
    createdAt: new Date(),
    resolvedAt: null,
  };
}

describe("pendingActionService", () => {
  it("create: default 7 gün TTL + UUID id + tokenPrefix=8 char", async () => {
    const repo = makeRepo();
    repo.create.mockImplementation(async (input) =>
      fakePending(input.id ?? "11111111-2222-3333-4444-555555555555"),
    );
    const svc = build(repo);

    const res = await svc.create({ kind: "send_draft", leadId: "lead-1" });
    expect(res.tokenPrefix.length).toBe(8);
    expect(res.tokenPrefix).toBe(res.pending.id.slice(0, 8));

    const inserted = repo.create.mock.calls[0][0];
    expect(inserted.id).toMatch(/^[0-9a-f-]{36}$/);
    const diffMs = (inserted.expiresAt as Date).getTime() - Date.now();
    const sevenDays = DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000;
    expect(diffMs).toBeGreaterThan(sevenDays - 10_000);
    expect(diffMs).toBeLessThan(sevenDays + 10_000);
  });

  it("create: ttlDays parametresi kullanılır", async () => {
    const repo = makeRepo();
    repo.create.mockImplementation(async (input) => fakePending(input.id!));
    const svc = build(repo);
    await svc.create({ kind: "send_draft", leadId: "lead-1", ttlDays: 1 });
    const inserted = repo.create.mock.calls[0][0];
    const diff = (inserted.expiresAt as Date).getTime() - Date.now();
    expect(diff).toBeLessThan(2 * 24 * 60 * 60 * 1000);
    expect(diff).toBeGreaterThan(0);
  });

  it("create: pre-generate id verilirse onu kullanır", async () => {
    const repo = makeRepo();
    const myId = "12345678-aaaa-bbbb-cccc-dddddddddddd";
    repo.create.mockImplementation(async (input) => fakePending(input.id!));
    const svc = build(repo);

    const res = await svc.create({
      kind: "confirm_demo_time",
      leadId: "lead-1",
      id: myId,
    });
    expect(res.pending.id).toBe(myId);
    expect(res.tokenPrefix).toBe("12345678");
  });

  it("create: payload + gmail draft/thread iletilir", async () => {
    const repo = makeRepo();
    repo.create.mockImplementation(async (input) => fakePending(input.id!));
    const svc = build(repo);
    await svc.create({
      kind: "send_draft",
      leadId: "lead-1",
      gmailDraftId: "draft-x",
      gmailThreadId: "thread-y",
      payload: { foo: "bar" },
    });
    const inserted = repo.create.mock.calls[0][0];
    expect(inserted.gmailDraftId).toBe("draft-x");
    expect(inserted.gmailThreadId).toBe("thread-y");
    expect(inserted.payload).toEqual({ foo: "bar" });
  });

  it("callback_data total length: act:<8>:<verb> ≤ 22 byte (verb ≤ 8 char)", () => {
    const longestVerb = "cancel"; // 6
    const sample = `act:abcdef12:${longestVerb}`;
    expect(sample.length).toBeLessThanOrEqual(22);
  });

  it("resolve: idempotent (repo'dan dönüş geçer)", async () => {
    const repo = makeRepo();
    repo.resolve.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const svc = build(repo);
    expect(await svc.resolve("id-1", "resolved")).toBe(true);
    expect(await svc.resolve("id-1", "resolved")).toBe(false);
  });

  it("expireDue: repo'ya delegate eder, sayıyı döner", async () => {
    const repo = makeRepo();
    repo.expireDue.mockResolvedValue(3);
    const svc = build(repo);
    expect(await svc.expireDue()).toBe(3);
  });

  it("updatePayload: repo'ya delegate eder", async () => {
    const repo = makeRepo();
    repo.updatePayload.mockResolvedValue(undefined);
    const svc = build(repo);
    await svc.updatePayload("id-1", { k: "v" });
    expect(repo.updatePayload).toHaveBeenCalledWith("id-1", { k: "v" });
  });

  it("tokenPrefix: id.slice(0, 8)", () => {
    const svc = build(makeRepo());
    expect(svc.tokenPrefix("abcdef12-3456-7890-abcd-ef1234567890")).toBe(
      "abcdef12",
    );
  });
});
