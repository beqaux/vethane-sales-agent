import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Integration testi — DATABASE_URL yoksa atlanır (lead.test.ts ile aynı pattern).
// Çalıştırmadan önce: pnpm db:migrate (pending_actions tablosu kurulu olmalı).
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("pendingActionRepo (integration)", () => {
  let leadRepo: typeof import("@/lib/db/repositories/lead").leadRepo;
  let pendingActionRepo:
    typeof import("@/lib/db/repositories/pending-action").pendingActionRepo;
  let leadId: string;
  const testEmail = `pending+${Date.now()}@example.com`;

  beforeAll(async () => {
    leadRepo = (await import("@/lib/db/repositories/lead")).leadRepo;
    pendingActionRepo = (await import("@/lib/db/repositories/pending-action"))
      .pendingActionRepo;
    const l = await leadRepo.upsertByEmail({
      email: testEmail,
      kurumAdi: "Pending Test Klinik",
      segment: "mid",
      tier: 1,
      durum: "yeni",
    });
    leadId = l.id;
  });

  it("create → byId → resolve idempotent (2. resolve false)", async () => {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const created = await pendingActionRepo.create({
      kind: "send_draft",
      leadId,
      gmailDraftId: "draft-1",
      gmailThreadId: "thread-1",
      payload: { foo: "bar" },
      expiresAt,
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.status).toBe("pending");
    expect(created.payload).toEqual({ foo: "bar" });

    const fetched = await pendingActionRepo.byId(created.id);
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.kind).toBe("send_draft");

    const first = await pendingActionRepo.resolve(created.id, "resolved");
    expect(first).toBe(true);

    const second = await pendingActionRepo.resolve(created.id, "resolved");
    expect(second).toBe(false);

    const final = await pendingActionRepo.byId(created.id);
    expect(final?.status).toBe("resolved");
    expect(final?.resolvedAt).not.toBeNull();
  });

  it("byPrefix 8-char prefix ile doğru pending'i bulur", async () => {
    const created = await pendingActionRepo.create({
      kind: "confirm_demo_time",
      leadId,
      gmailDraftId: null,
      gmailThreadId: "thread-2",
      payload: { raw: "Salı 14:00" },
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    const prefix = created.id.slice(0, 8);
    const found = await pendingActionRepo.byPrefix(prefix);
    expect(found?.id).toBe(created.id);

    // Resolved olanlar byPrefix'te görünmez (status=pending filtresi).
    await pendingActionRepo.resolve(created.id, "resolved");
    const after = await pendingActionRepo.byPrefix(prefix);
    expect(after).toBeNull();
  });

  it("updatePayload patch'ler (mevcut anahtarlar üzerine yazılır, kalanlar korunur)", async () => {
    const created = await pendingActionRepo.create({
      kind: "send_draft",
      leadId,
      gmailDraftId: "draft-x",
      gmailThreadId: null,
      payload: { a: 1, b: "two" },
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    await pendingActionRepo.updatePayload(created.id, {
      b: "TWO",
      c: { nested: true },
    });
    const after = await pendingActionRepo.byId(created.id);
    expect(after?.payload).toEqual({ a: 1, b: "TWO", c: { nested: true } });
    await pendingActionRepo.resolve(created.id, "cancelled");
  });

  it("expireDue: >TTL pending → 'expired', resolved'lara dokunmaz", async () => {
    // Geçmişte expire olmuş pending.
    const expired = await pendingActionRepo.create({
      kind: "send_draft",
      leadId,
      gmailDraftId: "draft-expire",
      gmailThreadId: null,
      payload: {},
      expiresAt: new Date(Date.now() - 1000),
    });
    // Geleceğe expire olacak pending.
    const fresh = await pendingActionRepo.create({
      kind: "send_draft",
      leadId,
      gmailDraftId: "draft-fresh",
      gmailThreadId: null,
      payload: {},
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    // Önceden resolve edilmiş.
    const resolved = await pendingActionRepo.create({
      kind: "send_draft",
      leadId,
      gmailDraftId: "draft-res",
      gmailThreadId: null,
      payload: {},
      expiresAt: new Date(Date.now() - 1000),
    });
    await pendingActionRepo.resolve(resolved.id, "resolved");

    const count = await pendingActionRepo.expireDue(new Date());
    expect(count).toBeGreaterThanOrEqual(1);

    const expiredAfter = await pendingActionRepo.byId(expired.id);
    expect(expiredAfter?.status).toBe("expired");
    expect(expiredAfter?.resolvedAt).not.toBeNull();

    const freshAfter = await pendingActionRepo.byId(fresh.id);
    expect(freshAfter?.status).toBe("pending");

    const resolvedAfter = await pendingActionRepo.byId(resolved.id);
    expect(resolvedAfter?.status).toBe("resolved");

    await pendingActionRepo.resolve(fresh.id, "cancelled");
  });

  afterAll(async () => {
    if (!hasDb || !leadId) return;
    // Lead cascade ile bağlı pending'leri de düşürür; durumu temizliğe çek.
    await leadRepo.updateDurum(leadId, "kaybedildi");
  });
});
