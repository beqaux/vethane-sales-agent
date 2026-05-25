import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Entegrasyon testi — DATABASE_URL yoksa atlanır (Neon dev branch ile çalışır).
// Çalıştırmadan önce: pnpm db:migrate (şema kurulu olmalı).
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("leadRepo (integration)", () => {
  let leadRepo: typeof import("@/lib/db/repositories/lead").leadRepo;
  let sequenceRepo: typeof import("@/lib/db/repositories/sequence").sequenceRepo;
  let suppressionRepo: typeof import("@/lib/db/repositories/suppression").suppressionRepo;
  const testEmail = `test+${Date.now()}@example.com`;

  beforeAll(async () => {
    leadRepo = (await import("@/lib/db/repositories/lead")).leadRepo;
    sequenceRepo = (await import("@/lib/db/repositories/sequence")).sequenceRepo;
    suppressionRepo = (await import("@/lib/db/repositories/suppression")).suppressionRepo;
  });

  it("upsertByEmail tekilleştirir ve küçük-harf normalize eder", async () => {
    const a = await leadRepo.upsertByEmail({
      email: testEmail.toUpperCase(),
      kurumAdi: "Test Klinik",
      segment: "mid",
      tier: 1,
      durum: "yeni",
    });
    const b = await leadRepo.upsertByEmail({ email: testEmail, kurumAdi: "Test Klinik 2" });
    expect(b.id).toBe(a.id);
    expect(b.email).toBe(testEmail.toLowerCase());
    expect(b.kurumAdi).toBe("Test Klinik 2");
  });

  it("dueForSend yalnız active + tier + due + email!=null döner", async () => {
    const lead = await leadRepo.byEmail(testEmail);
    expect(lead).not.toBeNull();
    await sequenceRepo.save({
      leadId: lead!.id,
      currentStep: 0,
      nextActionAt: new Date(Date.now() - 1000),
      lastSentAt: null,
      status: "active",
    });
    const due = await leadRepo.dueForSend(new Date(), [1], 10);
    expect(due.some((l) => l.id === lead!.id)).toBe(true);

    // Tier dışıysa gelmemeli
    const dueOtherTier = await leadRepo.dueForSend(new Date(), [3], 10);
    expect(dueOtherTier.some((l) => l.id === lead!.id)).toBe(false);
  });

  it("suppression.has eklenen adresi bulur", async () => {
    await suppressionRepo.add(testEmail, "manual");
    expect(await suppressionRepo.has(testEmail.toUpperCase())).toBe(true);
    expect(await suppressionRepo.has(`yok+${Date.now()}@example.com`)).toBe(false);
  });

  afterAll(async () => {
    if (!hasDb) return;
    const lead = await leadRepo.byEmail(testEmail);
    if (lead) await leadRepo.updateDurum(lead.id, "kaybedildi");
  });
});
